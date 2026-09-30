import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { readEvents } from "@/lib/events-store";
import { resolveDriftedClassId } from "@/lib/results/class-id-drift";
import { getEventClassesCached } from "@/lib/results/event-classes-cache";
import { LegAnalysisClient } from "./LegAnalysisClient";

type Props = {
  params: Promise<{ eventId: string; classId: string }>;
  searchParams: Promise<{ athlete?: string; disc?: string; d?: string; cn?: string; ri?: string; leg?: string }>;
};

/** 非負整数のクエリだけ通す（ri=走者番号・leg=レッグ番号。ミスの傾向の明細からのリンク用） */
function parseIndexParam(v: string | undefined): number | null {
  return typeof v === "string" && /^\d{1,4}$/.test(v) ? Number(v) : null;
}

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

/**
 * リンクに添えたクラス名（cn）と、今の classId のクラス名が違えば（mulka2 の再掲載で ID が振り直された）、
 * 名前で引き直した classId の URL を返す。取得失敗・決められないときは null＝そのまま開く。
 */
async function driftRedirect(
  eventId: number,
  classId: number,
  sp: Record<string, string | undefined>
): Promise<string | null> {
  const cn = typeof sp.cn === "string" && sp.cn ? sp.cn : null;
  if (!cn || Number.isNaN(eventId) || Number.isNaN(classId)) return null;
  try {
    const next = resolveDriftedClassId(await getEventClassesCached(eventId), classId, cn);
    if (next == null) return null;
    const q = new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => typeof e[1] === "string"));
    return `/results/${eventId}/${next}?${q.toString()}`;
  } catch (err) {
    console.warn(`[results] class drift check failed ev=${eventId} cl=${classId}:`, err);
    return null;
  }
}

export default async function ResultLegPage({ params, searchParams }: Props) {
  const { eventId, classId } = await params;
  const sp = await searchParams;
  // redirect() は例外で遷移するため try の外で呼ぶ
  const moved = await driftRedirect(Number(eventId), Number(classId), sp);
  if (moved) redirect(moved);
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
        runnerIndex={parseIndexParam(sp.ri)}
        focusLeg={parseIndexParam(sp.leg)}
      />
    </div>
  );
}
