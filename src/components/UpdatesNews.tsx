import Link from "next/link";
import { Newspaper } from "lucide-react";
import { supabaseAdmin } from "@/lib/supabase-admin";
import rankingsMeta from "@/data/rankings-meta.json";

/**
 * トップページ「更新情報」セクション（データ更新の自動フィード）。
 *
 * データ源:
 *  - rankings-meta.json（静的・週次ビルドのランキング更新時刻）
 *  - DB cron_log（job 別の最新成功時刻）   ← supabaseAdmin（サーバー専用）
 *  - DB lc_performances（直近反映の大会名） ← supabaseAdmin（サーバー専用）
 *
 * ローカルは SECRET_KEY 失効で DB 取得が失敗する → try/catch で握りつぶし、
 * 取得できたエントリだけ表示。全滅（エントリ0件）なら return null。
 */

interface NewsEntry {
  date: Date;
  label: string;
  href?: string; // 機能アナウンス等のリンク（任意）
  isNew?: boolean;
}

interface CronLogRow {
  job_name: string;
  created_at: string;
}

interface LcPerfRow {
  event_date: string;
  event_name: string;
}

const RANKINGS_META = rankingsMeta as { generatedAt?: string; generatedAtJst?: string };

/** ISO/日付文字列を JST の "YYYY/M/D" に整形。 */
function formatJstDate(d: Date): string {
  return d.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" });
}

export async function UpdatesNews() {
  const entries: NewsEntry[] = [];

  // 1) ランキング更新（静的・週次ビルド）
  if (RANKINGS_META.generatedAt) {
    const d = new Date(RANKINGS_META.generatedAt);
    if (!isNaN(d.getTime())) {
      entries.push({ date: d, label: "ランキングを更新" });
    }
  }

  // 2) cron_log: job 別の最新成功（sync-lapcenter / sync-entries / sync-events）
  const latestByJob = new Map<string, Date>();
  try {
    const { data } = await supabaseAdmin
      .from("cron_log")
      .select("job_name, created_at")
      .eq("status", "success")
      .in("job_name", ["sync-lapcenter", "sync-entries", "sync-events"])
      .order("created_at", { ascending: false });
    for (const row of (data as CronLogRow[] | null) ?? []) {
      // 降順取得なので job_name 初出が最新。後続は無視。
      if (!latestByJob.has(row.job_name)) {
        const d = new Date(row.created_at);
        if (!isNaN(d.getTime())) latestByJob.set(row.job_name, d);
      }
    }
  } catch {
    /* ローカル鍵失効など → cron 由来エントリは出さない */
  }

  // 3) lc_performances: 直近反映の大会名（成績エントリのラベルに使う）
  let latestEventName: string | null = null;
  try {
    const { data } = await supabaseAdmin
      .from("lc_performances")
      .select("event_date, event_name")
      .lte("event_date", new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }))
      .order("event_date", { ascending: false })
      .limit(1);
    const row = ((data as LcPerfRow[] | null) ?? [])[0];
    if (row?.event_name) latestEventName = row.event_name;
  } catch {
    /* 取れなければ大会名なしのラベルにフォールバック */
  }

  // cron 由来エントリを構築
  const lapcenter = latestByJob.get("sync-lapcenter");
  if (lapcenter) {
    entries.push({
      date: lapcenter,
      label: latestEventName
        ? `『${latestEventName}』ほかの成績（巡航速度・ミス率）を反映`
        : "成績データ（巡航速度・ミス率）を更新",
    });
  }
  const syncEntries = latestByJob.get("sync-entries");
  if (syncEntries) {
    entries.push({ date: syncEntries, label: "エントリー情報を更新" });
  }
  const syncEvents = latestByJob.get("sync-events");
  if (syncEvents) {
    entries.push({ date: syncEvents, label: "イベント情報を更新" });
  }

  // 新機能アナウンス（静的）。データ更新フィードに新機能のお知らせを1件加える。
  entries.push({
    date: new Date("2026-06-29T00:00:00+09:00"),
    label: "新機能『結果分析』を追加 — LapCenter のスプリットからレッグ別タイム分析",
    href: "/results",
    isNew: true,
  });

  // エントリ0件ならセクションごと非表示
  if (entries.length === 0) return null;

  // 日付降順
  entries.sort((a, b) => b.date.getTime() - a.date.getTime());

  return (
    <section className="border-b border-border py-12 sm:py-16">
      <div className="mx-auto max-w-6xl px-4">
        <div className="flex items-center gap-2">
          <Newspaper className="h-4 w-4 text-primary" />
          <h2 className="text-lg font-bold">更新情報</h2>
          <span className="text-xs text-muted">データの最終更新</span>
        </div>

        <ul className="mt-5 divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {entries.map((e, i) => (
            <li key={i} className="flex items-center gap-3 px-4 py-3 sm:gap-4">
              <span className="w-20 flex-shrink-0 font-mono text-xs text-muted sm:w-24">
                {formatJstDate(e.date)}
              </span>
              {e.href ? (
                <span className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                  <Link href={e.href} className="truncate text-primary hover:underline">
                    {e.label}
                  </Link>
                  {e.isNew && (
                    <span className="flex-shrink-0 rounded bg-primary/15 px-1.5 py-0.5 text-[9px] font-bold text-primary">
                      NEW
                    </span>
                  )}
                </span>
              ) : (
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">{e.label}</span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
