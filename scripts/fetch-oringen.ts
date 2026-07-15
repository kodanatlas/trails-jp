/**
 * O-Ringen 日本勢データを取得して trails.jp の ingest へ POST する。
 *
 * **GitHub Actions の runner で動かす想定**（.github/workflows/sync-oringen.yml）。
 * Vercel Hobby の関数は 60 秒上限で、既存 sync-entries が同じ形で 504 を起こしエントリー索引を
 * 凍結させた実績があるため、取得を Vercel に持ち込まない。
 *
 * 使い方:
 *   ORINGEN_INGEST_URL=https://trailsjp.vercel.app/api/oringen/ingest \
 *   ORINGEN_INGEST_SECRET=xxx \
 *   npx tsx scripts/fetch-oringen.ts [--dry-run]
 *
 * 設計と実測は docs/plans/2026-07-15_abroad_oringen.md を参照。
 */

import { normalize, toLocalDate, type RawResult, type NameMapEntry } from "../src/lib/oringen/normalize";
import type { OringenData, OringenRace } from "../src/lib/oringen/types";
import nameMapJson from "../src/data/oringen-name-map.json";

const API = "https://resultat.oringen.se/api";
const SLUG = "2026";
const EVENT_ID = 25;

/**
 * 取得するクラスを日本勢が居る 30 クラスに絞る（全 189 クラスだと 45秒/27MB）。
 *
 * **割り切り**: エントリー締切後に 31 番目のクラスへ日本人が現れたら漏れる。2026 は締切済みで
 * 名簿が確定しているため許容する。クラス名で解決するので classId のハードコードは避ける。
 * 名簿が動きうる大会に流用するなら、ここを全クラス取得に戻すこと。
 */
const JP_CLASS_NAMES = new Set([
  "H21", "H21 Lång", "H21 Kort-2", "H40", "H45", "H55", "H60", "H60 Kort", "H70", "H70 Kort", "H75",
  "D10", "D13", "D21", "D21 Lång", "D21 Kort-2", "D35 Motion", "D40 Kort", "D55 Kort",
  "Pre-Elit", "Blå 2,5", "Blå 3,5",
  "Etappstart Blå 3,5", "Etappstart Gul 2,5", "Etappstart Gul 3,5",
  "Etappstart Orange 2,5", "Etappstart Orange 3,3", "Etappstart Orange 4,0",
  "Etappstart Svart 7,5", "3-dagars Svart 7,5", "MTBO Etappstart Svår kort",
]);

interface EventJson {
  i: number;
  n: string;
  t: string;
  r: { i: number; rn: number; st: string }[];
  c: { i: number; n: string; r?: { r: number; mi?: number }[] }[];
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return (await res.json()) as T;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  console.log("イベント情報を取得中...");
  const event = await getJson<EventJson>(
    `${API}/events/slugs/${SLUG}?includeOrganisations=true&includeClassCategories=true`,
  );

  const races: OringenRace[] = [...event.r]
    .sort((a, b) => a.rn - b.rn)
    .map((r) => ({
      n: r.rn,
      raceId: r.i,
      // race.st も UTC。日付は現地(Europe/Stockholm)で切る
      date: toLocalDate(r.st) ?? r.st.slice(0, 10),
    }));

  const targetClasses = event.c.filter((c) => JP_CLASS_NAMES.has(c.n));
  if (targetClasses.length === 0) {
    throw new Error("対象クラスが1つも解決できませんでした（クラス名の変更を疑ってください）");
  }
  console.log(`  ${event.n} / 対象クラス ${targetClasses.length}/${event.c.length} / ${races.length} 日`);

  const classNames: Record<number, string> = {};
  const distances: Record<string, number> = {};
  for (const c of event.c) {
    classNames[c.i] = c.n;
    for (const r of c.r ?? []) {
      if (typeof r.mi === "number") distances[`${r.r}:${c.i}`] = r.mi;
    }
  }

  const classIds = targetClasses.map((c) => c.i).join(",");
  const raws: RawResult[] = [];
  for (const race of races) {
    const url = `${API}/races/${race.raceId}/classes/results/json?classIds=${encodeURIComponent(classIds)}`;
    const recs = await getJson<RawResult[]>(url);
    raws.push(...recs);
    console.log(`  ${race.n} 日目 取得完了（${recs.length} 件）`);
  }

  const people = normalize({
    raws,
    races,
    classNames,
    distances,
    nameMap: nameMapJson as Record<string, NameMapEntry>,
  });

  const data: OringenData = {
    generatedAt: new Date().toISOString(),
    eventId: EVENT_ID,
    eventName: event.n,
    resultUrl: `https://resultat.oringen.se/${SLUG}`,
    races,
    people,
    links: {
      official: "https://oringen.se",
      eventor: "https://eventor.orientering.se/Events/Show/50594",
      // Livelox / WinSplits の ID はイベント properties にあるが URL 形式が未確認。
      // 誤リンクより無リンクの方がマシなので null にしている。
      livelox: null,
      winsplits: null,
    },
  };

  const confirmed = people.reduce(
    (a, p) => a + Object.values(p.entries).flat().filter((e) => e.startTime).length,
    0,
  );
  const entries = people.reduce((a, p) => a + Object.values(p.entries).flat().length, 0);
  console.log(`日本勢: ${people.length} 名 / 延べ ${entries} エントリー / スタート時刻確定 ${confirmed}`);

  if (dryRun) {
    console.log("--dry-run のため POST しません");
    console.log(JSON.stringify({ ...data, people: people.slice(0, 2) }, null, 2));
    return;
  }

  const url = process.env.ORINGEN_INGEST_URL;
  const secret = process.env.ORINGEN_INGEST_SECRET;
  if (!url || !secret) throw new Error("ORINGEN_INGEST_URL / ORINGEN_INGEST_SECRET が未設定です");

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
    body: JSON.stringify(data),
  });
  const body = await res.text();
  console.log(`ingest -> HTTP ${res.status}: ${body}`);

  // HTTP 200 でも品質ガードのブロック（success:false）がありうる。
  // 200 だけ見て成功扱いにすると「更新されていないのに緑」になる（entry-index-backstop.yml と同じ規約）。
  if (!res.ok) throw new Error(`ingest が非200を返しました: ${res.status}`);
  const parsed = JSON.parse(body) as { success?: boolean; blocked?: string };
  if (parsed.success !== true) {
    throw new Error(`ingest が更新を拒否しました（blocked=${parsed.blocked}）。既存データは保持されています。`);
  }
  console.log("done");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
