import {
  MANUAL_LC_NO_MATCH,
  normalize,
  type LapCenterEvent,
} from "@/lib/scraper/lapcenter";

export interface MatchGapLcCandidate {
  eventId: number;
  name: string;
}

export interface MatchGapCandidate {
  joe_event_id: number;
  joe_name: string;
  date: string;
  joe_url: string;
  lc: MatchGapLcCandidate[];
  affinity: number;
  tier: "likely" | "possible";
}

interface MatchGapJoeEvent {
  joe_event_id: number;
  name: string;
  date: string;
  joe_url: string;
  lapcenter_event_id?: number;
  tags?: string[];
  source?: string;
}

export const LIKELY_AFFINITY_THRESHOLD = 0.15;
export const DEFAULT_WINDOW_DAYS = 60;
export const EXCLUDED_TAGS = ["講習", "ロゲ", "SKI", "どこオリ"] as const;
export const EXCLUDED_NAME_KEYWORDS = [
  "中止",
  "延期",
  "研修",
  "講習",
  "オンライン",
  "報告会",
  "連絡会",
  "総会",
  "説明会",
  "表彰",
] as const;

const DAY_MS = 24 * 60 * 60 * 1000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const AFFINITY_ROUNDING_FACTOR = 1000;

function bigrams(value: string): Set<string> {
  const characters = [...value];
  const result = new Set<string>();
  for (let index = 0; index < characters.length - 1; index += 1) {
    result.add(characters[index] + characters[index + 1]);
  }
  return result;
}

/** 正規化後の文字バイグラムについて、短い集合を基準にした重なり率を返す。 */
export function nameAffinity(a: string, b: string): number {
  const normalizedA = normalize(a).replace(/\s/g, "");
  const normalizedB = normalize(b).replace(/\s/g, "");
  const bigramsA = bigrams(normalizedA);
  const bigramsB = bigrams(normalizedB);
  if (bigramsA.size === 0 || bigramsB.size === 0) return 0;

  const smaller = bigramsA.size <= bigramsB.size ? bigramsA : bigramsB;
  const larger = smaller === bigramsA ? bigramsB : bigramsA;
  let common = 0;
  for (const bigram of smaller) {
    if (larger.has(bigram)) common += 1;
  }

  const overlap = common / smaller.size;
  return Math.round(overlap * AFFINITY_ROUNDING_FACTOR) / AFFINITY_ROUNDING_FACTOR;
}

function formatUtcDate(date: Date): string {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

/** 実行環境のローカルTZに依存せず、JST暦日の対象範囲を求める。 */
function jstDateWindow(now: Date, windowDays: number): { start: string; end: string } {
  const nowJst = new Date(now.getTime() + JST_OFFSET_MS);
  const endJstMidnightUtc = Date.UTC(
    nowJst.getUTCFullYear(),
    nowJst.getUTCMonth(),
    nowJst.getUTCDate(),
  );
  const startJstMidnightUtc = endJstMidnightUtc - windowDays * DAY_MS;
  return {
    start: formatUtcDate(new Date(startJstMidnightUtc)),
    end: formatUtcDate(new Date(endJstMidnightUtc)),
  };
}

function isExcluded(event: MatchGapJoeEvent, start: string, end: string): boolean {
  if (event.date < start || event.date > end) return true;
  if (event.lapcenter_event_id != null) return true;
  if (MANUAL_LC_NO_MATCH[event.joe_event_id] !== undefined) return true;
  if (event.source === "dokori") return true;
  if (EXCLUDED_TAGS.some((excludedTag) => event.tags?.includes(excludedTag))) return true;
  return EXCLUDED_NAME_KEYWORDS.some((keyword) => event.name.includes(keyword));
}

/**
 * JOY未突合かつ同日に未使用LapCenterイベントがある大会を抽出する。
 *
 * 閾値0.15の根拠は、実データ8ペアを**EVENT_ALIASES 追加前**に実測した値（2026-08-24）。
 * 真の漏れが 0.333 / 0.214 / 0.167、誤検出が 0.167 / 0 / 0 / 0 / 0 で、真の「中高選手権 団体」と
 * 誤検出の「千葉大OLC 技術局練習会 × 入間市OLC夏合宿」がともに 0.167 で同値＝類似度では
 * 分離できなかった。真をすべて拾う側に倒し、残る誤検出は MANUAL_LC_NO_MATCH でミュートする。
 *
 * 同日に中高選手権・彩の森入間公園の alias を EVENT_ALIASES へ追加したため、上記3件の実測値は
 * 現在 0.84 / 0.364 / 0.905 まで上がっている（nameAffinity は fuzzyMatch と同じ normalize を通す）。
 * **この新しい値を根拠に閾値を上げてはいけない**。alias があるケースは既に自動突合されるので
 * そもそも検知に上がらず、ここに来るのは alias が無い未知の漏れ＝旧レンジ（0.15〜0.35 程度）
 * だからである。閾値を上げると拾いたいものだけが落ちる。
 */
export function findMatchGaps(
  joeEvents: MatchGapJoeEvent[],
  lcEvents: LapCenterEvent[],
  opts: { now: Date; windowDays: number },
): MatchGapCandidate[] {
  // ウィンドウ外も含む全JOYイベントの割当を予約し、使用中LCを誤って候補に戻さない。
  const assignedLcIds = new Set(
    joeEvents
      .map((event) => event.lapcenter_event_id)
      .filter((eventId): eventId is number => eventId != null),
  );
  const unusedLcByDate = new Map<string, LapCenterEvent[]>();
  for (const lcEvent of lcEvents) {
    if (assignedLcIds.has(lcEvent.eventId)) continue;
    const eventsOnDate = unusedLcByDate.get(lcEvent.date) ?? [];
    unusedLcByDate.set(lcEvent.date, [...eventsOnDate, lcEvent]);
  }

  const { start, end } = jstDateWindow(opts.now, opts.windowDays);
  return joeEvents
    .filter((event) => !isExcluded(event, start, end))
    .flatMap((event): MatchGapCandidate[] => {
      const candidates = unusedLcByDate.get(event.date) ?? [];
      if (candidates.length === 0) return [];

      const affinity = candidates.reduce(
        (maximum, candidate) => Math.max(maximum, nameAffinity(event.name, candidate.name)),
        0,
      );
      return [{
        joe_event_id: event.joe_event_id,
        joe_name: event.name,
        date: event.date,
        joe_url: event.joe_url,
        lc: candidates.map(({ eventId, name }) => ({ eventId, name })),
        affinity,
        tier: affinity >= LIKELY_AFFINITY_THRESHOLD ? "likely" : "possible",
      }];
    })
    .sort((a, b) => {
      if (a.tier !== b.tier) return a.tier === "likely" ? -1 : 1;
      return b.date.localeCompare(a.date);
    });
}
