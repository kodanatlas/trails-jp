/**
 * O-Ringen（スウェーデン・世界最大のオリエンテーリング大会）の日本勢データ。
 *
 * 出どころは resultat.oringen.se の**未文書 JSON API**（SPA バンドルから発見）。公開ページの転記ではない。
 * 詳細と設計判断は docs/plans/2026-07-15_abroad_oringen.md 参照。
 */

/** 大会1日分（O-Ringen は5日間。2026 は 7/22 が休養日のため 3日目が 7/23）。 */
export interface OringenRace {
  /** 1〜5 */
  n: number;
  /** raceId（API の raceId） */
  raceId: number;
  /** YYYY-MM-DD（現地日付） */
  date: string;
}

/** ある日の1エントリー。1人が同じ日に複数クラスへ出ることがあるため配列で持つ。 */
export interface OringenEntry {
  className: string;
  /**
   * HH:MM。**スウェーデン現地時間（Europe/Stockholm）に変換済み**。
   *
   * API の生値は UTC で、そのまま出すと2時間ズレる（2026-07-15 に実害バグとして発覚）。
   * 変換は `normalize.ts` の `toHhmm()` が唯一の窓口。
   *
   * **未抽選なら null**（取得漏れではなく O-Ringen 側が未抽選）。
   */
  startTime: string | null;
  /** 順位。開催前・未確定は null */
  place: number | null;
  /** 完走タイム "H:MM:SS"。開催前・未確定は null */
  time: string | null;
  /** 距離(m)。クラス×日で決まる */
  distanceM: number | null;
}

/**
 * 日本勢1名。
 *
 * **生年は持たない。** O-Ringen 自身が画面に出していない値であり、検索エンジンに載る公開サイトが
 * API から掘り起こして再掲する理由がないため（2026-07-15 ユーザー判断）。同定はクラス＋クラブで足りる。
 */
export interface OringenPerson {
  /** ローマ字 "姓 名"。O-Ringen 現地の掲示・呼出しで使われる正式表記＝一次キー */
  name: string;
  /** 漢字氏名。未特定なら null */
  kanji: string | null;
  /** "high" = 確定 / "medium" = 推定（読み・クラブから人手照合。UI で区別する） */
  kanjiConfidence: "high" | "medium" | null;
  club: string;
  /** stage番号("1"〜"5") → その日のエントリー配列 */
  entries: Record<string, OringenEntry[]>;
}

/** Storage `app-data/oringen-2026.json` の中身。 */
export interface OringenData {
  /** ISO8601。**いつ時点のデータか**。更新が止まったことをユーザーが検知する唯一の手段 */
  generatedAt: string;
  eventId: number;
  eventName: string;
  /** 結果サイトの大会ページ */
  resultUrl: string;
  races: OringenRace[];
  people: OringenPerson[];
  /** 公式・外部サービスへの導線（会場情報は API に無いので公式へ送る） */
  links: {
    official: string;
    eventor: string | null;
    livelox: string | null;
    winsplits: string | null;
  };
}
