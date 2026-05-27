import type { Metadata } from "next";
import { EventList } from "./EventList";
import { readEvents } from "@/lib/events-store";

export const dynamic = "force-dynamic"; // 常に最新データを表示

export const metadata: Metadata = {
  title: "イベント",
  description: "JOYと連携した全国のオリエンテーリングイベント情報。",
};

export default async function EventsPage() {
  const events = await readEvents();

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-1 flex items-center gap-2">
        <h1 className="text-2xl font-bold">イベント</h1>
        <span className="rounded bg-accent/20 px-2 py-0.5 text-[10px] font-medium text-[#00e5ff]">
          JOY 連携
        </span>
      </div>
      <p className="mb-6 text-xs text-muted">
        JOY から日次自動取得。{events.length} 件のイベント
      </p>
      <EventList events={events} />
    </div>
  );
}
