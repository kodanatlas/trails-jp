// Japan-O-entrY から取得したデータのサンプル（実運用時はDBから取得）

import type { JOEEvent } from "@/lib/scraper/events";

export const sampleJOEEvents: JOEEvent[] = [
  { joe_event_id: 2400, name: "京葉OLクラブ大会", date: "2026-02-22", prefecture: "千葉県", venue: "千葉県", entry_status: "closed", tags: ["ランキング対象"], joe_url: "https://japan-o-entry.com/event/view/2400" },
  { joe_event_id: 2401, name: "関東スプリントシリーズ #3", date: "2026-03-15", prefecture: "東京都", venue: "東京都", entry_status: "open", tags: ["公認大会", "ランキング対象"], joe_url: "https://japan-o-entry.com/event/view/2401" },
  { joe_event_id: 2402, name: "千葉OL練習会 3月", date: "2026-03-08", prefecture: "千葉県", venue: "千葉県", entry_status: "open", tags: ["初心者歓迎"], joe_url: "https://japan-o-entry.com/event/view/2402" },
  { joe_event_id: 2403, name: "第30回インカレロング", date: "2026-06-14", end_date: "2026-06-15", prefecture: "千葉県", venue: "千葉県", entry_status: "none", tags: ["公認大会", "ランキング対象"], joe_url: "https://japan-o-entry.com/event/view/2403" },
  { joe_event_id: 2404, name: "中部スプリントカップ 2026", date: "2026-04-19", prefecture: "愛知県", venue: "愛知県", entry_status: "open", tags: ["公認大会"], joe_url: "https://japan-o-entry.com/event/view/2404" },
  { joe_event_id: 2405, name: "第50回全日本オリエンテーリング選手権大会", date: "2026-11-15", end_date: "2026-11-16", prefecture: "長野県", venue: "長野県", entry_status: "none", tags: ["公認大会", "ランキング対象"], joe_url: "https://japan-o-entry.com/event/view/2405" },
  { joe_event_id: 2406, name: "静岡OLC新年練習会", date: "2026-01-10", prefecture: "静岡県", venue: "静岡県", entry_status: "closed", tags: ["初心者歓迎"], joe_url: "https://japan-o-entry.com/event/view/2406" },
  { joe_event_id: 2407, name: "北海道OL協会 春季大会", date: "2026-05-03", prefecture: "北海道", venue: "北海道", entry_status: "none", tags: ["公認大会"], joe_url: "https://japan-o-entry.com/event/view/2407" },
  { joe_event_id: 2408, name: "関西OLクラブ交流会", date: "2026-03-22", prefecture: "大阪府", venue: "大阪府", entry_status: "open", tags: ["初心者歓迎"], joe_url: "https://japan-o-entry.com/event/view/2408" },
  { joe_event_id: 2409, name: "東北スプリント大会", date: "2026-04-05", prefecture: "宮城県", venue: "宮城県", entry_status: "open", tags: ["公認大会", "ランキング対象"], joe_url: "https://japan-o-entry.com/event/view/2409" },
];
