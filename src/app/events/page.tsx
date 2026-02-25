import type { Metadata } from "next";
import type { JOEEvent } from "@/lib/scraper/events";
import { Bell } from "lucide-react";
import { EventList } from "./EventList";
import eventsJson from "@/data/events.json";

export const metadata: Metadata = {
  title: "イベント",
  description: "JOYと連携した全国のオリエンテーリングイベント情報。",
};

export default function EventsPage() {
  const events = eventsJson as JOEEvent[];

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-1 flex items-center gap-2">
        <h1 className="text-2xl font-bold">イベント</h1>
        <span className="rounded bg-accent/20 px-2 py-0.5 text-[10px] font-medium text-[#00e5ff]">
          JOY 連携
        </span>
      </div>
      <p className="mb-2 text-xs text-muted">
        JOY から日次自動取得。{events.length} 件のイベント
      </p>
      <p className="mb-6 flex items-center gap-1.5 text-xs text-muted">
        <span className="inline-flex items-center gap-0.5 rounded bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-400">
          <Bell className="h-2.5 w-2.5" />
          更新
        </span>
        = JOY の更新履歴に掲載されている大会
      </p>
      <EventList events={events} />
    </div>
  );
}
