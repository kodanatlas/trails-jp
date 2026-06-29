import type { Metadata } from "next";
import { readEvents } from "@/lib/events-store";
import { LegAnalysisClient } from "./LegAnalysisClient";

type Props = {
  params: Promise<{ eventId: string; classId: string }>;
  searchParams: Promise<{ athlete?: string; disc?: string; d?: string; cn?: string }>;
};

/** lapcenter_event_id から大会名・日付を解決（events ストア。mulka2 は叩かない）。 */
async function resolveEvent(eventId: number): Promise<{ name: string; date: string } | null> {
  if (Number.isNaN(eventId)) return null;
  try {
    const events = await readEvents();
    const ev = events.find((x) => x.lapcenter_event_id === eventId);
    return ev ? { name: ev.name, date: ev.date } : null;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { eventId } = await params;
  const ev = await resolveEvent(Number(eventId));
  return {
    title: ev ? `${ev.name} レッグ分析` : "レッグ分析",
    description: "LapCenter のスプリットを元にした1レースのレッグ別分析（trails.jp 結果分析）。",
  };
}

export default async function ResultLegPage({ params, searchParams }: Props) {
  const { eventId, classId } = await params;
  const sp = await searchParams;
  const discipline = sp.disc === "forest" || sp.disc === "sprint" ? sp.disc : null;
  // 不正な日付が自己平均の基準除外に混入しないよう YYYY-MM-DD のみ通す
  const excludeDate = sp.d && /^\d{4}-\d{2}-\d{2}$/.test(sp.d) ? sp.d : null;
  const ev = await resolveEvent(Number(eventId));
  const className = typeof sp.cn === "string" && sp.cn ? sp.cn : null;

  return (
    <div className="mx-auto max-w-[480px] px-4 py-6">
      <LegAnalysisClient
        eventId={Number(eventId)}
        classId={Number(classId)}
        athlete={sp.athlete ?? null}
        discipline={discipline}
        excludeDate={excludeDate}
        eventName={ev?.name ?? null}
        eventDate={ev?.date ?? excludeDate}
        className={className}
      />
    </div>
  );
}
