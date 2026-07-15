import type { OringenEntry, OringenPerson, OringenRace } from "./types";
import { isFreeStart } from "./start-type";

/**
 * O-Ringen API の生レコード → 表示用モデル。純関数（外部依存なし・決定的）。
 *
 * API の短縮キーは SPA バンドルのリーダー関数から特定した（docs/plans/2026-07-15_abroad_oringen.md）。
 * 未文書 API なので、**フィールドが欠けても throw せず null に落とす**方針にする。
 */

/** API の生レコード（必要な部分だけ。未文書なので全て optional 前提で扱う） */
export interface RawResult {
  /** person */
  p?: { f?: string; l?: string; b?: number; s?: string; n?: string };
  /** organisation */
  o?: { i?: number; ei?: string; n?: string; c?: string };
  /** class */
  c?: { i?: number };
  /** raceId */
  r?: number;
  /** entryId */
  e?: number;
  /** startTime "YYYY-MM-DDTHH:MM:SS"（現地時間）。未抽選なら欠落 */
  st?: string;
  /** 削除フラグ */
  d?: boolean;
  /** overallElapsedTimeAtStart（累計。順位計算には使わない） */
  ot?: number;
}

export interface NameMapEntry {
  kanji: string;
  confidence: "high" | "medium";
}

/** O-Ringen 開催地のタイムゾーン。夏は CEST(+2)、冬は CET(+1)。 */
export const EVENT_TIME_ZONE = "Europe/Stockholm";

const hhmmFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: EVENT_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/**
 * API の startTime → 現地(Europe/Stockholm)の "HH:mm"。壊れていたら null。
 *
 * **`st` は UTC**。"2026-07-20T08:22:00" とタイムゾーン接尾辞が無いので現地時間に見えるが違う。
 * 公式サイトは `moment(st).tz("Europe/Stockholm").format("HH:mm:ss")` で表示している。
 *
 * 2026-07-15、この取り違えで全ステージが2時間早く表示される実害バグを出した（公式の competitors ページ
 * と突合して発覚。児玉健 Stage1 は公式 10:22 に対し 08:22 と表示していた）。
 * **オフセットをハードコードしない**（冬開催や夏時間の境界で壊れる）。必ず tz 変換を通すこと。
 */
export function toHhmm(st: string | undefined | null): string | null {
  if (!st || typeof st !== "string") return null;
  // 既に Z / オフセット付きならそのまま、無ければ UTC とみなして Z を足す
  const iso = /(Z|[+-]\d{2}:?\d{2})$/.test(st) ? st : `${st}Z`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const hhmm = hhmmFormatter.format(d);
  return /^\d{2}:\d{2}$/.test(hhmm) ? hhmm : null;
}

/** API の race.st(UTC) → 現地の "YYYY-MM-DD"。日付も現地で切る（深夜窓での日跨ぎ対策）。 */
export function toLocalDate(st: string | undefined | null): string | null {
  if (!st || typeof st !== "string") return null;
  const iso = /(Z|[+-]\d{2}:?\d{2})$/.test(st) ? st : `${st}Z`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  // en-CA は YYYY-MM-DD 形式
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: EVENT_TIME_ZONE }).format(d);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

/** 秒 → "H:MM:SS"。null/0/負値は null（0 は「未計測」であって 0 秒完走ではない）。 */
export function toDuration(seconds: number | null | undefined): string | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return null;
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

/** 元データの表記ゆれ補正。同一人物が別姓で登録されている実例に対応する。 */
const NAME_FIXES: Record<string, string> = {
  // 2026: OK22 の田中雅崇が 1日だけ "Tanak" で登録されている（O-Ringen 側の入力ミス）
  "Tanak Masataka": "Tanaka Masataka",
};

/** 生レコードから人物キー（ローマ字 "姓 名"）を作る。作れなければ null。 */
export function personKey(raw: RawResult): string | null {
  const last = raw.p?.l?.trim();
  const first = raw.p?.f?.trim();
  if (!last || !first) return null;
  const key = `${last} ${first}`;
  return NAME_FIXES[key] ?? key;
}

export interface NormalizeInput {
  /** 全 race の生レコード（日本人以外も混在してよい。ここで絞る） */
  raws: RawResult[];
  races: OringenRace[];
  /** classId → クラス名 */
  classNames: Record<number, string>;
  /** `${raceId}:${classId}` → 距離(m) */
  distances: Record<string, number>;
  /** ローマ字氏名 → 漢字 */
  nameMap: Record<string, NameMapEntry>;
}

/**
 * 日本勢のみを抽出して表示用モデルに整形する。
 *
 * - 日本人判定は**クラブの国コード `o.c === "JPN"`**。個人国籍 `p.n` は全件 "other" で使えない。
 *   なお これは厳密には「日本クラブ所属」判定であり「日本人」判定ではない（主要姓140件で全58,621件を
 *   走査したところ海外クラブ所属の日本人は0件だったため、2026 ではこれで足りる）。
 * - **生年（p.b）は意図的に捨てる**。公開サイトに載せない判断（types.ts のコメント参照）。
 * - 削除済みエントリー（d=true）は除外する。
 */
export function normalize(input: NormalizeInput): OringenPerson[] {
  const { raws, races, classNames, distances, nameMap } = input;
  const raceNumberOf = new Map(races.map((r) => [r.raceId, r.n]));
  const byPerson = new Map<string, OringenPerson>();

  for (const raw of raws) {
    if (raw.d) continue;
    if (raw.o?.c !== "JPN") continue;

    const key = personKey(raw);
    if (!key) continue;

    const raceId = raw.r;
    const stage = raceId === undefined ? undefined : raceNumberOf.get(raceId);
    if (stage === undefined) continue;

    const classId = raw.c?.i;
    const className = classId === undefined ? undefined : classNames[classId];
    if (!className) continue;

    let person = byPerson.get(key);
    if (!person) {
      const mapped = nameMap[key];
      person = {
        name: key,
        kanji: mapped?.kanji ?? null,
        kanjiConfidence: mapped?.confidence ?? null,
        club: raw.o?.n ?? "",
        entries: {},
      };
      byPerson.set(key, person);
    }

    const entry: OringenEntry = {
      className,
      startTime: toHhmm(raw.st),
      // 開催前は順位・タイムとも存在しない。結果が入り始めたら API 側の仕様を見て詰める。
      place: null,
      time: null,
      distanceM: distances[`${raceId}:${classId}`] ?? null,
    };

    const slot = (person.entries[String(stage)] ??= []);
    // 同一 (person, stage, class) が重複して返ることがあるため冪等にする
    if (!slot.some((e) => e.className === entry.className)) slot.push(entry);
  }

  // クラブ → 氏名 の安定ソート（描画側が並べ替えるが、JSON の diff を安定させるため）
  return [...byPerson.values()].sort(
    (a, b) => a.club.localeCompare(b.club) || a.name.localeCompare(b.name),
  );
}

/** startTime が確定しているエントリー数。品質ガードと UI の両方で使う。 */
export function countConfirmedStarts(people: OringenPerson[]): number {
  let n = 0;
  for (const p of people) {
    for (const entries of Object.values(p.entries)) {
      for (const e of entries) if (e.startTime) n++;
    }
  }
  return n;
}

/**
 * 抽選クラス（＝スタート時刻が割り当てられる）のエントリー数。
 *
 * 「確定 93/245」と出すと、残り152が「待てば埋まる」ように読める。実際は**フリースタートで
 * 永久に埋まらない**（2026-07-15 に発覚した誤り。start-type.ts のコメント参照）。
 * 分母を抽選クラスだけにすれば「93/93 = 全部確定」と正しく言える。
 */
export function countDrawnEntries(people: OringenPerson[]): number {
  let n = 0;
  for (const p of people) {
    for (const entries of Object.values(p.entries)) {
      for (const e of entries) if (!isFreeStart(e.className)) n++;
    }
  }
  return n;
}

/** 延べエントリー数。 */
export function countEntries(people: OringenPerson[]): number {
  let n = 0;
  for (const p of people) {
    for (const entries of Object.values(p.entries)) n += entries.length;
  }
  return n;
}
