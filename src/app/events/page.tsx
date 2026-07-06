import type { Metadata } from "next";
import { EventList, type EventListItem } from "./EventList";
import { readEvents, getEventsLastSync } from "@/lib/events-store";
import type { JOEEvent } from "@/lib/scraper/events";

// events.json は日次 cron（sync-events 03:00 JST / sync-lapcenter 12:00 JST）でしか変わらない → 10分 ISR で十分
export const revalidate = 600;

export const metadata: Metadata = {
  title: "イベント",
  description: "JOYと連携した全国のオリエンテーリングイベント情報。",
};

// RSC ペイロードには EventList が参照するフィールドだけを載せる（venue/lat/lng 等は死荷重）。
// optional フィールドは undefined のままキーを載せると Flight が "$undefined" を書き込むため、値がある時だけ含める。
function toListItem(e: JOEEvent): EventListItem {
  return {
    joe_event_id: e.joe_event_id,
    name: e.name,
    date: e.date,
    prefecture: e.prefecture,
    entry_status: e.entry_status,
    tags: e.tags,
    joe_url: e.joe_url,
    ...(e.end_date !== undefined && { end_date: e.end_date }),
    ...(e.recently_updated !== undefined && { recently_updated: e.recently_updated }),
    ...(e.update_label !== undefined && { update_label: e.update_label }),
    ...(e.lapcenter_event_id !== undefined && { lapcenter_event_id: e.lapcenter_event_id }),
    ...(e.lapcenter_url !== undefined && { lapcenter_url: e.lapcenter_url }),
  };
}

export default async function EventsPage() {
  const [allEvents, lastSync] = await Promise.all([
    readEvents(),
    getEventsLastSync(),
  ]);
  const events = allEvents.map(toListItem);
  const lastSyncJst = lastSync
    ? new Date(lastSync).toLocaleString("ja-JP", {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-1 flex items-center gap-2">
        <h1 className="text-2xl font-bold">イベント</h1>
        <span className="rounded bg-accent/20 px-2 py-0.5 text-[10px] font-medium text-[#00e5ff]">
          JOY 連携
        </span>
      </div>
      <p className="mb-6 text-xs text-muted">
        {events.length} 件
        {lastSyncJst ? `・最終更新: ${lastSyncJst} JST` : ""}
      </p>
      <EventList events={events} />
    </div>
  );
}
