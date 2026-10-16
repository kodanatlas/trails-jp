import { extractEventHeaders } from "./event-headers";

// JOY ランキングの大会列追加を検知して再ビルド要否を判定する。
// 設計: docs/plans/2026-10-16_joy_ranking_auto_rebuild.md

/** 監視対象。ヘッダは種別内で共通・種別間で異なる（2026-10-16 実測）ため種別ごとに代表1クラス。 */
export const WATCHED_RANKINGS = [
  { file: "elite_forest_M21E.json", typeId: 5, classId: 39 },
  { file: "elite_sprint_S_Open.json", typeId: 17, classId: 85 },
  { file: "age_forest_無差別.json", typeId: 1, classId: 1 },
  { file: "age_sprint_S_無差別.json", typeId: 15, classId: 47 },
] as const;

/** ビルドが public/data/ranking-headers.json に書く manifest。 */
export interface HeaderManifest {
  generatedAt: string;
  categories: Record<string, { status: "fetched" | "kept"; headers: string[] }>;
}

export const MANIFEST_PATH = "/data/ranking-headers.json";

export type CategoryCheck =
  | { file: string; status: "ok" }
  | { file: string; status: "stale"; missing: string[] }
  | { file: string; status: "unknown"; error: string };

/** 自動再ビルドの上限（ループ防止）。 */
export const AUTO_LIMITS = { minIntervalHours: 20, windowDays: 7, maxInWindow: 2 } as const;

export type DeployDecision =
  | { action: "weekly" }
  | { action: "joy_updated" }
  | { action: "none"; skipped?: "history_unavailable" | "min_interval" | "window_cap" };

export function parseManifest(json: unknown): HeaderManifest | null {
  if (!json || typeof json !== "object") return null;
  const { generatedAt, categories } = json as Record<string, unknown>;
  if (typeof generatedAt !== "string" || !categories || typeof categories !== "object") return null;
  const parsed: HeaderManifest["categories"] = {};
  for (const [file, value] of Object.entries(categories as Record<string, unknown>)) {
    const v = value as { status?: unknown; headers?: unknown } | null;
    if (!v || (v.status !== "fetched" && v.status !== "kept")) return null;
    if (!Array.isArray(v.headers) || !v.headers.every((h) => typeof h === "string")) return null;
    parsed[file] = { status: v.status, headers: v.headers as string[] };
  }
  return { generatedAt, categories: parsed };
}

/**
 * 1カテゴリの判定。JOY にあって配信中 manifest に無い大会列があれば stale。
 * 取得失敗・大会列0件・manifest 欠落/kept は「不明」（stale にしない＝発火しない）。
 */
export function compareCategory(
  file: string,
  joy: { headers: string[] } | { error: string },
  manifest: HeaderManifest | null,
): CategoryCheck {
  if ("error" in joy) return { file, status: "unknown", error: joy.error };
  if (joy.headers.length === 0) return { file, status: "unknown", error: "no event headers on JOY page" };
  if (!manifest) return { file, status: "unknown", error: "manifest unavailable" };
  const entry = manifest.categories[file];
  if (!entry) return { file, status: "unknown", error: "category missing in manifest" };
  if (entry.status !== "fetched") return { file, status: "unknown", error: `manifest status ${entry.status}` };
  // 比較元が0件なら JOY の全列が missing に見えるだけ（ビルド時の抽出失敗）。比較に使わない。
  if (entry.headers.length === 0) return { file, status: "unknown", error: "no event headers in manifest" };
  const deployed = new Set(entry.headers);
  const missing = joy.headers.filter((h) => !deployed.has(h));
  return missing.length > 0 ? { file, status: "stale", missing } : { file, status: "ok" };
}

/**
 * 再ビルド判定。水曜は検知によらず weekly。それ以外は stale があり、かつ上限内のときだけ joy_updated。
 * history は過去の joy_updated 送信時刻（ISO）。null = 履歴を読めなかった → 発火しない。
 */
export function decideDeploy(input: {
  isWednesday: boolean;
  checks: readonly CategoryCheck[];
  history: readonly string[] | null;
  now: number;
}): DeployDecision {
  if (input.isWednesday) return { action: "weekly" };
  if (!input.checks.some((c) => c.status === "stale")) return { action: "none" };
  if (input.history === null) return { action: "none", skipped: "history_unavailable" };

  const ages = input.history.map((at) => input.now - Date.parse(at)).filter((ms) => Number.isFinite(ms));
  const hour = 3_600_000;
  if (ages.some((ms) => ms < AUTO_LIMITS.minIntervalHours * hour)) {
    return { action: "none", skipped: "min_interval" };
  }
  const inWindow = ages.filter((ms) => ms < AUTO_LIMITS.windowDays * 24 * hour).length;
  if (inWindow >= AUTO_LIMITS.maxInWindow) return { action: "none", skipped: "window_cap" };
  return { action: "joy_updated" };
}

async function fetchJoyHeaders(typeId: number, classId: number, timeoutMs: number): Promise<string[]> {
  const url = `https://japan-o-entry.com/ranking/ranking/ranking_index/${typeId}/${classId}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "trails.jp/1.0 (ranking freshness check)" },
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`JOY HTTP ${res.status}`);
  const html = await res.text();
  if (!/<table/i.test(html)) throw new Error("JOY page has no table");
  return extractEventHeaders(html);
}

async function fetchManifest(origin: string, timeoutMs: number): Promise<HeaderManifest | null> {
  const res = await fetch(new URL(MANIFEST_PATH, origin), {
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) return null;
  return parseManifest(await res.json());
}

/** JOY と配信中 manifest を並列取得して全監視カテゴリを判定する。例外は投げない。 */
export async function checkRankingStaleness(origin: string, timeoutMs = 8000): Promise<CategoryCheck[]> {
  const [manifestResult, ...joyResults] = await Promise.allSettled([
    fetchManifest(origin, timeoutMs),
    ...WATCHED_RANKINGS.map((w) => fetchJoyHeaders(w.typeId, w.classId, timeoutMs)),
  ]);
  const manifest = manifestResult.status === "fulfilled" ? (manifestResult.value as HeaderManifest | null) : null;
  return WATCHED_RANKINGS.map((w, i) => {
    const r = joyResults[i];
    const joy = r.status === "fulfilled" ? { headers: r.value as string[] } : { error: String(r.reason) };
    return compareCategory(w.file, joy, manifest);
  });
}

export type HookResult = { status: "accepted"; job: string | null } | { status: "failed"; error: string };

/** Deploy Hook を1回だけ送る（失敗しても当日は再送しない）。 */
export async function sendDeployHook(hookUrl: string, timeoutMs = 10000): Promise<HookResult> {
  try {
    const res = await fetch(hookUrl, { method: "POST", signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { status: "failed", error: `HTTP ${res.status}` };
    const data = (await res.json().catch(() => null)) as { job?: { id?: string } } | null;
    return { status: "accepted", job: data?.job?.id ?? null };
  } catch (e) {
    return { status: "failed", error: String(e) };
  }
}
