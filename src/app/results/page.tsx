import type { Metadata } from "next";
import { readEvents } from "@/lib/events-store";
import { ResultsBrowse } from "./ResultsBrowse";

export const metadata: Metadata = {
  title: "結果分析",
  description: "LapCenter のスプリットを元にしたレッグ別レース分析（trails.jp 結果分析）。",
};

// events ストアは日次 cron（sync-events 19:07 JST / sync-lapcenter 21:41 JST・vercel.json が正）
// でしか変わらない → 10分 ISR で十分
export const revalidate = 600;

export default async function ResultsLanding() {
  let events: { eventId: number; name: string; date: string }[] = [];
  try {
    const all = await readEvents();
    events = all
      .filter((e) => e.lapcenter_event_id)
      .map((e) => ({ eventId: e.lapcenter_event_id!, name: e.name, date: e.date }))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 250);
  } catch {
    // 読めなければ空一覧
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-1 flex items-center gap-2">
        <h1 className="text-2xl font-bold">結果分析</h1>
        <span className="rounded bg-accent/20 px-2 py-0.5 text-[10px] font-medium text-[#00e5ff]">LapCenter</span>
      </div>
      <p className="mb-5 text-xs text-muted">
        スプリットを元にしたレッグ別のレース分析。大会を選ぶ → クラス → レース。選手ページの参加大会からも開けます。
        大会一覧は LapCenter 掲載後、毎日の自動同期（夜 19 時ごろ）で追加されます。
      </p>
      <ResultsBrowse events={events} />
    </div>
  );
}
