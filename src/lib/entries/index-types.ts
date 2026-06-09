/**
 * 選手別エントリーインデックスの型定義。
 * 日次 cron (sync-entries) が生成し、Supabase Storage (app-data/entry-index.json) に保存する。
 * 照合キーは normalizeNameKey（NFKC正規化＋空白除去, src/lib/name-key.ts）。build-index と API で同一関数を使う。
 * リレーのメンバー個人・別名（旧姓等）も索引側で個別キーに展開済み。
 */

/** 選手1人の1エントリー（=ある大会への出場予定） */
export interface AthleteEntryRef {
  joe_event_id: number;
  /** 大会名 */
  eventName: string;
  /** 開催日 YYYY-MM-DD */
  date: string;
  /** 開催都道府県 */
  prefecture: string;
  /** このエントリーのクラス (M21A 等) */
  className: string;
  /** エントリー時の所属（生文字列・表示用） */
  affiliation: string;
  /** JOYイベントの受付状態。none = events.json で判定不能（アーカイブ由来等）＝バッジ非表示 */
  entryStatus: "open" | "closed" | "none";
  /** JOY 大会詳細ページ URL（カードのリンク先） */
  joeUrl: string;
  /** その大会の総エントリー数（表示用） */
  totalEntries: number;
}

/** 氏名(スペース除去)キー → エントリー配列（date 昇順） */
export interface EntryIndex {
  /** 生成時刻 ISO */
  generatedAt: string;
  /** スクレイプ対象に選んだ大会数 */
  targetEventCount: number;
  /** 実際に取得成功した大会数（部分許容の可視化） */
  scrapedEventCount: number;
  athletes: Record<string, AthleteEntryRef[]>;
}
