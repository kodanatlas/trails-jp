import type { Metadata } from "next";
import { EventList } from "./EventList";
import { readEvents, getEventsLastSync } from "@/lib/events-store";

export const dynamic = "force-dynamic"; // 常に最新データを表示

export const metadata: Metadata = {
  title: "イベント",
  description: "JOYと連携した全国のオリエンテーリングイベント情報。",
};

export default async function EventsPage() {
  const events = await readEvents();
  const lastSync = await getEventsLastSync();
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
