import { redirect } from "next/navigation";
import { unstable_cache } from "next/cache";
import { readEvents } from "@/lib/events-store";
import { fetchEventClasses } from "@/lib/scraper/lapcenter";

// 遷移高速化: 解決に使う2つの取得をデータキャッシュに載せる。
// events ストア(マッチ済 lapcenter_event_id 含む)は日次cronでしか変わらない → 5分キャッシュ。
const getEventsCached = unstable_cache(() => readEvents(), ["results-go-events"], { revalidate: 300 });
// イベント内クラス一覧は不変 → 1日キャッシュ（解決の最遅部＝mulka2取得を温め、再クリックを即時化）。
const getEventClassesCached = unstable_cache((eventId: number) => fetchEventClasses(eventId), ["results-go-classes"], {
  revalidate: 86400,
});

/**
 * 入口①の解決ルート。選手ページのリンクから渡された
 *   ?e=<JOEイベント名>&d=<日付>&c=<クラス名>&athlete=<選手キー>&disc=<forest|sprint>
 * を、LapCenter の eventId / classId に解決して /results/[eventId]/[classId] へ redirect する。
 * - eventId: events ストアを (name,date) で引く（lc_performances の event_name は events.name と同一）
 * - classId: fetchEventClasses で className 一致を引く
 * 解決不能なら選手分析へフォールバック。
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // fetchEventClasses が undici(カスタム dispatcher) を使うため
export const maxDuration = 30;

type Props = {
  searchParams: Promise<{ e?: string; d?: string; c?: string; athlete?: string; disc?: string }>;
};

export default async function ResultsGo({ searchParams }: Props) {
  const { e, d, c, athlete, disc } = await searchParams;
  const fallback = `/analysis${athlete ? `?athlete=${encodeURIComponent(athlete)}` : ""}`;
  if (!e || !d || !c) redirect(fallback);

  let target: string | null = null;
  try {
    const events = await getEventsCached();
    const ev = events.find((x) => x.name === e && x.date === d && x.lapcenter_event_id);
    if (!ev?.lapcenter_event_id) {
      console.warn(`[results/go] no LapCenter-matched event for name="${e}" date="${d}"`);
    } else {
      const classes = await getEventClassesCached(ev.lapcenter_event_id);
      const cls = classes.find((k) => k.className === c);
      if (!cls) {
        console.warn(
          `[results/go] class "${c}" not in event ${ev.lapcenter_event_id} (classes: ${classes.map((k) => k.className).join(",")})`,
        );
      } else {
        const q = new URLSearchParams();
        if (athlete) q.set("athlete", athlete);
        if (disc === "forest" || disc === "sprint") q.set("disc", disc);
        q.set("d", d);
        q.set("cn", c); // クラス名（文脈ヘッダー表示用）
        target = `/results/${ev.lapcenter_event_id}/${cls.classId}?${q.toString()}`;
      }
    }
  } catch (err) {
    console.error("results/go resolve failed:", err);
  }

  redirect(target ?? fallback);
}
