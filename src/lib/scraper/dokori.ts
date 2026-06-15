/**
 * どこオリ (dokori.net) 大会ページのスクレイパ（日別対応）。
 *
 * どこオリは Next.js (App Router / RSC) アプリで、公開イベントページは全データを
 * React Server Component の "flight" ペイロード
 *   <script>self.__next_f.push([N,"...escaped..."])</script>
 * に server-render する。各 push の文字列を unescape して連結すると、クリーンな
 * JSON 断片を含む ~300KB のテキスト（flight）が得られる。
 *
 * 複数日大会では各日で参加者が異なる（予選/決勝・会場違い）。flight 内の `byDay` 配列が
 * 日(dayId)ごとの `individualEntrants`（その日の参加者）を持つので、**1つの publicId を
 * 日別の複数 JOEEvent に展開**して取り込む（trails.jp 既存モデル＝1イベント=1 joe_event_id
 * にそのまま乗せる）。日別IDは合成ID（baseEventId + dayIndex）で採番する。
 *
 * 出力契約は JOY スクレイパと同一（EntryListResult / JOEEvent）。下流（一覧・選手ページ・
 * 配車割）は型しか見ないため無改修で日別に動く。
 */
import { splitAffiliations } from "@/lib/club-normalize";
import { normalizeNameKey } from "@/lib/name-key";
import type { JOEEvent } from "./events";
import type { EntryListResult, EntryRow, TeamGroup } from "./entries";

export const DOKORI_BASE_URL = "https://www.dokori.net";

/** どこオリ用の合成イベントID予約レンジ（JOYの整数IDと衝突させない）。 */
export const DOKORI_ID_BASE = 90_000_000;
/** 1イベント(publicId)に予約するID幅。日別IDは baseEventId + dayIndex で採番する。 */
export const DOKORI_EVENT_BLOCK = 100;

const NO_AFFILIATION = "所属なし";

export interface DokoriRegistryEntry {
  publicId: string;
  /** 日別IDの起点。Day1=baseEventId, Day2=baseEventId+1, ... */
  baseEventId: number;
}

/** ホワイトリスト（取り込む対象はここに登録した大会のみ）。1イベント=連続したID幅を専有。 */
export const DOKORI_EVENTS: DokoriRegistryEntry[] = [
  { publicId: "evt_tortoise_50th", baseEventId: DOKORI_ID_BASE + 1 }, // Day1=90000001, Day2=90000002, Day3=90000003
];

export function isDokoriEventId(id: number): boolean {
  return id >= DOKORI_ID_BASE;
}

export interface DokoriRef {
  publicId: string;
  baseEventId: number;
  /** 0=Day1, 1=Day2, ... （日付昇順） */
  dayIndex: number;
}

/** 合成 eventId から (publicId, dayIndex) を解決。 */
export function getDokoriRef(eventId: number): DokoriRef | null {
  for (const e of DOKORI_EVENTS) {
    if (eventId >= e.baseEventId && eventId < e.baseEventId + DOKORI_EVENT_BLOCK) {
      return { publicId: e.publicId, baseEventId: e.baseEventId, dayIndex: eventId - e.baseEventId };
    }
  }
  return null;
}

/** 後方互換: publicId だけ要るとき。 */
export function getDokoriPublicId(eventId: number): string | null {
  return getDokoriRef(eventId)?.publicId ?? null;
}

/**
 * HTML から RSC flight ペイロードを復元する。
 * `self.__next_f.push([N,"..."])` の各文字列を JSON unescape して連結する。
 * （tests から呼ぶため export）
 */
export function reconstructFlight(html: string): string {
  const re = /self\.__next_f\.push\(\[\d+,\s*"((?:[^"\\]|\\.)*)"\]\)/g;
  let m: RegExpExecArray | null;
  let flight = "";
  while ((m = re.exec(html)) !== null) {
    try {
      flight += JSON.parse('"' + m[1] + '"');
    } catch {
      flight += m[1];
    }
  }
  return flight;
}

/** flight 内の openIdx 位置（'[' or '{'）からバランス対応する閉じ括弧までを切り出す。 */
function balancedSlice(flight: string, openIdx: number): string | null {
  const open = flight[openIdx];
  const close = open === "[" ? "]" : "}";
  let depth = 0;
  let inStr = false;
  for (let i = openIdx; i < flight.length; i++) {
    const ch = flight[i];
    if (inStr) {
      if (ch === "\\") i++;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      if (--depth === 0) return flight.slice(openIdx, i + 1);
    }
  }
  return null;
}

/** RSC リテラル参照（$undefined / $L4c 等）を JSON 化のため null に置換。 */
function cleanRsc(raw: string): string {
  return raw.replace(/"\$undefined"/g, "null").replace(/:\s*\$[A-Za-z0-9_]+/g, ":null");
}

/** flight から `"<key>":[...]` をバランス抽出して JSON.parse。失敗時は null。 */
function extractArray<T>(flight: string, key: string): T[] | null {
  const at = flight.indexOf(`"${key}":[`);
  if (at < 0) return null;
  const open = flight.indexOf("[", at);
  const raw = balancedSlice(flight, open);
  if (!raw) return null;
  try {
    const v = JSON.parse(cleanRsc(raw));
    return Array.isArray(v) ? (v as T[]) : null;
  } catch {
    return null;
  }
}

interface DokoriDayMeta {
  dayId?: string;
  id?: string;
  date?: string;
  raceDistance?: string;
  label?: string;
  terrainName?: string;
  location?: string;
  venueName?: string;
  venueGeo?: { lat?: number; lng?: number } | null;
}

interface DokoriEntrant {
  name: string;
  classes: string[];
  status: string;
  club: string | null;
}

interface DokoriByDay {
  dayId: string;
  individualEntrants?: DokoriEntrant[];
}

/** 日メタ（days[]）を日付昇順で返す。dayIndex の基準（Day1=最早日）。 */
function orderedDays(flight: string): DokoriDayMeta[] {
  const days = extractArray<DokoriDayMeta>(flight, "days") ?? [];
  return days
    .filter((d) => !!d.date)
    .slice()
    .sort((a, b) => (a.date as string).localeCompare(b.date as string));
}

/** byDay[] を dayId → その日の individualEntrants にマップ。 */
function entrantsByDay(flight: string): Map<string, DokoriEntrant[]> {
  const arr = extractArray<DokoriByDay>(flight, "byDay") ?? [];
  const map = new Map<string, DokoriEntrant[]>();
  for (const d of arr) {
    if (d && d.dayId) map.set(d.dayId, Array.isArray(d.individualEntrants) ? d.individualEntrants : []);
  }
  return map;
}

/** confirmed / pending_payment のみ有効（cancelled 等は除外）。 */
function isValidStatus(status: string): boolean {
  return status === "confirmed" || status === "pending_payment";
}

/** その日の参加者配列を EntryListResult（所属グループ・total=ユニーク人数）に整形。 */
function entrantsToResult(
  entrants: DokoriEntrant[],
  eventId: number,
  fetchedAt: string,
): EntryListResult {
  const valid = entrants.filter((e) => isValidStatus(e.status));

  // 各 entrant の各クラスごとに1行（その日のクラス）。
  const rows: EntryRow[] = [];
  for (const ent of valid) {
    const classes = ent.classes && ent.classes.length > 0 ? ent.classes : [""];
    for (const className of classes) {
      rows.push({ className, name: ent.name, affiliation: ent.club ?? "" });
    }
  }

  // 所属でグループ化（複数所属は分割して両方に計上＝JOY と同じ二重計上）。
  const map = new Map<string, EntryRow[]>();
  for (const row of rows) {
    const clubs = splitAffiliations(row.affiliation);
    const keys = clubs.length > 0 ? clubs : [NO_AFFILIATION];
    for (const key of keys) {
      const list = map.get(key);
      if (list) list.push(row);
      else map.set(key, [row]);
    }
  }

  const teams: TeamGroup[] = [...map.entries()]
    .map(([affiliation, entries]) => ({ affiliation, count: entries.length, entries }))
    .sort((a, b) => b.count - a.count || a.affiliation.localeCompare(b.affiliation, "ja"));

  // total はその日のユニーク人数（氏名の正準キーで重複排除）。
  const persons = new Set<string>();
  for (const ent of valid) persons.add(normalizeNameKey(ent.name));

  return { eventId, total: persons.size, teams, fetchedAt };
}

/**
 * どこオリ大会ページのHTMLから「指定 eventId の日」のエントリー一覧を返す。純関数。
 * eventId のレンジで publicId/dayIndex を解決し、その日の individualEntrants を整形する。
 */
export function parseDokoriEntryList(html: string, eventId: number): EntryListResult {
  const flight = reconstructFlight(html);
  const fetchedAt = new Date().toISOString();

  const ref = getDokoriRef(eventId);
  const days = orderedDays(flight);
  const day = days[ref ? ref.dayIndex : 0];
  // days[] の UUID は `id`、byDay[] 側は同じ UUID を `dayId` で持つ（キー名が違う）。
  const dayUuid = day?.id ?? day?.dayId;
  if (!dayUuid) return { eventId, total: 0, teams: [], fetchedAt };

  const ents = entrantsByDay(flight).get(dayUuid) ?? [];
  return entrantsToResult(ents, eventId, fetchedAt);
}

// --- 大会メタデータ ---

/** 申込締切（ISO 日時）を flight から抽出。日時形のみ採用（UIラベルを誤取得しない）。 */
function extractDeadlineMs(flight: string): number | null {
  const isoDeadline = flight.match(/"deadline":"(\d{4}-\d{2}-\d{2}T[^"]*)"/);
  if (isoDeadline) {
    const ms = Date.parse(isoDeadline[1]);
    if (!Number.isNaN(ms)) return ms;
  }
  const reg = flight.match(/"registrationDeadline":"(\d{4}-\d{2}-\d{2}[^"]*)"/);
  if (reg) {
    const ms = Date.parse(reg[1].replace(" ", "T"));
    if (!Number.isNaN(ms)) return ms;
  }
  return null;
}

/** <title> から ` | どこオリ` を除いた大会名を取得。 */
function extractTitle(html: string): string {
  const m = html.match(/<title>([^<]*)<\/title>/i);
  if (!m) return "";
  return m[1].replace(/\s*\|\s*どこオリ\s*$/, "").trim();
}

function distanceJa(raceDistance?: string): string {
  switch (raceDistance) {
    case "middle":
      return "ミドル";
    case "long":
      return "ロング";
    case "sprint":
      return "スプリント";
    case "ultralong":
      return "ウルトラロング";
    default:
      return "";
  }
}

type DokoriJOEEvent = JOEEvent & {
  source?: "joy" | "dokori";
  dokori_public_id?: string;
};

/**
 * どこオリ大会ページのHTMLから **日別の JOEEvent 配列** を生成する。純関数。
 * 1つの publicId を、日付昇順で Day1..DayN の独立イベント（合成ID = baseEventId + dayIndex）に展開。
 */
export function parseDokoriEvents(
  html: string,
  publicId: string,
  baseEventId: number,
  now: number = Date.now(),
): JOEEvent[] {
  const flight = reconstructFlight(html);
  const days = orderedDays(flight);
  const title = extractTitle(html);
  const deadlineMs = extractDeadlineMs(flight);
  const entry_status: JOEEvent["entry_status"] =
    deadlineMs === null ? "none" : now < deadlineMs ? "open" : "closed";

  return days.map((d, i) => {
    const date = d.date as string;
    const location = d.location ?? "";
    const prefMatch = location.match(/^(.+?[都道府県])/);
    const prefecture = prefMatch ? prefMatch[1] : location;
    const venue = d.venueName ?? d.terrainName ?? location ?? undefined;

    let lat: number | null = null;
    let lng: number | null = null;
    const geo = d.venueGeo;
    if (geo && typeof geo.lat === "number" && typeof geo.lng === "number") {
      if (geo.lat >= 20 && geo.lat <= 50 && geo.lng >= 120 && geo.lng <= 155) {
        lat = geo.lat;
        lng = geo.lng;
      }
    }

    const [, mm, dd] = date.split("-");
    const md = `${Number(mm)}/${Number(dd)}`;
    const distLabel = `${distanceJa(d.raceDistance)}${d.label ?? ""}`.trim();
    const name = distLabel ? `${title}（${md} ${distLabel}）` : `${title}（${md}）`;

    const event: DokoriJOEEvent = {
      joe_event_id: baseEventId + i,
      name,
      date,
      event_type: d.raceDistance,
      prefecture,
      venue,
      entry_status,
      tags: ["どこオリ"],
      joe_url: `${DOKORI_BASE_URL}/event/${publicId}`,
      lat,
      lng,
      source: "dokori",
      dokori_public_id: publicId,
    };
    return event;
  });
}

// --- ネットワーク ---

const ENTRY_UA = "trails.jp/1.0 (dokori entry list)";
const EVENT_UA = "trails.jp/1.0 (dokori event sync)";

/**
 * どこオリ大会ページを取得し、指定 eventId の日のエントリー一覧を返す。
 * 上流HTMLは1時間キャッシュ（同一URLなので複数日分の取得もキャッシュで相乗り）。
 * throwOnError の意味論は scrapeEntryList と同一。
 */
export async function scrapeDokoriEntryList(
  eventId: number,
  opts: { signal?: AbortSignal; throwOnError?: boolean } = {},
): Promise<EntryListResult> {
  const ref = getDokoriRef(eventId);
  const emptyResult = (): EntryListResult => ({
    eventId,
    total: 0,
    teams: [],
    fetchedAt: new Date().toISOString(),
  });

  if (!ref) {
    if (opts.throwOnError) throw new Error(`unknown dokori event id: ${eventId}`);
    return emptyResult();
  }

  const res = await fetch(`${DOKORI_BASE_URL}/event/${ref.publicId}`, {
    headers: { "User-Agent": ENTRY_UA },
    next: { revalidate: 3600 },
    signal: opts.signal,
  });
  if (!res.ok) {
    if (opts.throwOnError) {
      throw new Error(`dokori entry fetch failed: ${res.status} (event ${eventId})`);
    }
    return emptyResult();
  }
  const html = await res.text();
  return parseDokoriEntryList(html, eventId);
}

/**
 * ホワイトリスト（DOKORI_EVENTS）の各大会ページを取得し、**日別に展開した** JOEEvent[] を返す。
 * 1ページ取得につき複数日分の JOEEvent を生成。1件の失敗がバッチ全体を落とさないよう隔離。
 */
export async function scrapeDokoriEvents(
  opts: { signal?: AbortSignal } = {},
): Promise<JOEEvent[]> {
  const events: JOEEvent[] = [];
  for (const entry of DOKORI_EVENTS) {
    try {
      const res = await fetch(`${DOKORI_BASE_URL}/event/${entry.publicId}`, {
        headers: { "User-Agent": EVENT_UA },
        next: { revalidate: 0 },
        signal: opts.signal,
      });
      if (!res.ok) continue;
      const html = await res.text();
      events.push(...parseDokoriEvents(html, entry.publicId, entry.baseEventId));
    } catch {
      // イベント単位で隔離: 1件の失敗で他を巻き込まない。
      continue;
    }
  }
  return events;
}
