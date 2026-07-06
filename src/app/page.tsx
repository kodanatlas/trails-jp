import Link from "next/link";
import { CalendarDays, Trophy, ExternalLink, BarChart3, TrendingUp, ChevronDown, Route } from "lucide-react";
import { readEvents } from "@/lib/events-store";
import weekendPointsJson from "@/data/weekend-points.json";
import { WeekendHighlights } from "@/components/WeekendHighlights";
import { HeroAthleteSearch } from "./HeroSearch";
import { WeeklyCheerPodium } from "@/components/WeeklyCheerPodium";
import { UpdatesNews } from "@/components/UpdatesNews";
import { getSiteStats } from "@/lib/site-stats";

// イベント（日次 cron 03:00 JST 更新）と DB 由来の数値をライブ反映する。1時間毎で十分
export const revalidate = 3600;

export default async function Home() {
  // バンドル JSON はコミット時点で凍結し「近日開催」から直近大会が欠けるため、Storage のライブデータを読む
  const allEvents = await readEvents();
  const now = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  const upcomingEvents = allEvents
    .filter((e) => e.date >= now)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 4);

  // 規模数値は docs ページと共有のヘルパーから取得（両ページで常に一致）
  const stats = await getSiteStats(allEvents.length);

  // ハイライトの上部リンク表示判定（ポイントリストが3件以上＝必ずセクションが出る時のみ）
  const hasHighlights =
    ((weekendPointsJson as { items?: unknown[] }).items ?? []).length >= 3;

  return (
    <div>
      {/* Hero — エディトリアル（テキストのみ・左寄せ・余白で構成） */}
      <section className="border-b border-border bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:py-20 lg:py-24">
          <div className="max-w-3xl">
              <p className="flex items-center gap-2.5 text-xs font-medium tracking-wide text-muted">
                <span className="h-px w-8 bg-primary/70" />
                日本のオリエンテーリング・データプラットフォーム
              </p>
              <h1 className="mt-5 text-4xl font-bold leading-[1.18] tracking-tight sm:text-5xl lg:text-6xl">
                <span className="text-primary">オリエンティア</span>を、
                <br />
                ライバルを、
                <br />
                データで読む。
              </h1>
              <p className="mt-5 max-w-xl text-base leading-relaxed text-foreground/75 sm:text-lg">
                <span className="inline-block">巡航速度・ミス率・調子まで、</span>
                <span className="inline-block">選手をまるごと分析。</span>
              </p>
              <HeroAthleteSearch />
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <Link
                  href="/events"
                  className="inline-flex items-center gap-2 rounded-lg border border-border-strong px-6 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-card-hover"
                >
                  <CalendarDays className="h-4 w-4" />
                  イベント
                </Link>
                <Link
                  href="/rankings"
                  className="inline-flex items-center gap-2 rounded-lg border border-border-strong px-6 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-card-hover"
                >
                  <Trophy className="h-4 w-4" />
                  ランキング
                </Link>
                <Link
                  href="/analysis"
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-2.5 text-sm font-bold text-background transition-colors hover:bg-primary-dark"
                >
                  <BarChart3 className="h-4 w-4" />
                  選手分析
                </Link>
                <Link
                  href="/results"
                  className="inline-flex items-center gap-2 rounded-lg border border-primary/50 bg-primary/10 px-6 py-2.5 text-sm font-bold text-primary transition-colors hover:bg-primary/20"
                >
                  <Route className="h-4 w-4" />
                  結果分析
                </Link>
              </div>
              {/* 直近の大会ハイライトへのジャンプ */}
              {hasHighlights && (
                <a
                  href="#weekend-highlights"
                  className="mt-6 inline-flex items-center gap-1.5 text-xs font-medium text-positive transition-colors hover:text-foreground"
                >
                  <TrendingUp className="h-3.5 w-3.5" />
                  直近の大会ハイライトを見る
                  <ChevronDown className="h-3.5 w-3.5" />
                </a>
              )}
          </div>
        </div>
      </section>

      {/* Stats — エディトリアルなコールアウト（アクセント左ボーダー・mono 数値・カード装飾なし） */}
      <section className="border-b border-border bg-card">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-x-6 gap-y-6 px-4 py-8 sm:grid-cols-4">
          {[
            { value: stats.events.toLocaleString(), label: "収集イベント" },
            { value: stats.athletes.toLocaleString(), label: "ランキング掲載選手" },
            { value: stats.lcRecords.toLocaleString(), label: "成績レコード" },
            { value: stats.clubs.toLocaleString(), label: "クラブ" },
          ].map((stat) => (
            <div key={stat.label} className="border-l-2 border-primary/60 pl-4">
              <div className="font-mono text-2xl font-bold tabular-nums text-foreground sm:text-3xl">
                {stat.value}
              </div>
              <div className="mt-1 text-xs text-muted">{stat.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* 直近の大会ハイライト（上=ビルド時静的・下=ランタイム RPC） */}
      <WeekendHighlights />

      {/* Upcoming Events (JOY連携) */}
      <section className="border-b border-border bg-surface py-12 sm:py-16">
        <div className="mx-auto max-w-6xl px-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold">近日開催のイベント</h2>
              <span className="rounded bg-accent/20 px-1.5 py-0.5 text-[9px] font-medium text-[#00e5ff]">
                JOY連携
              </span>
            </div>
            <Link href="/events" className="text-xs font-medium text-primary hover:underline">
              すべて見る →
            </Link>
          </div>
          <div className="mt-5 space-y-2">
            {upcomingEvents.map((event) => {
              const entryBadge = event.entry_status === "open"
                ? { bg: "bg-green-500/15", text: "text-green-400", label: "受付中" }
                : event.entry_status === "closed"
                ? { bg: "bg-white/5", text: "text-muted", label: "締切済" }
                : null;

              return (
                <a
                  key={event.joe_event_id}
                  href={event.joe_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-4 rounded-lg border border-border bg-card p-4 transition-all hover:border-primary/30 hover:bg-card-hover"
                >
                  <div className="hidden w-16 flex-shrink-0 text-center sm:block">
                    <div className="font-mono text-xl font-bold tabular-nums text-primary">
                      {new Date(event.date).getDate()}
                    </div>
                    <div className="text-xs text-muted">
                      {new Date(event.date).toLocaleDateString("ja-JP", { month: "short" })}
                    </div>
                  </div>
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {entryBadge && (
                        <span className={`rounded px-2 py-0.5 text-[10px] font-medium ${entryBadge.bg} ${entryBadge.text}`}>
                          {entryBadge.label}
                        </span>
                      )}
                      {event.tags.map((tag) => (
                        <span key={tag} className="rounded bg-white/5 px-2 py-0.5 text-[10px] text-muted">
                          {tag}
                        </span>
                      ))}
                      <span className="text-xs text-muted sm:hidden">
                        {new Date(event.date).toLocaleDateString("ja-JP", { month: "short", day: "numeric" })}
                      </span>
                    </div>
                    <h3 className="mt-1 text-sm font-semibold">{event.name}</h3>
                    <p className="text-xs text-muted">{event.prefecture}</p>
                  </div>
                  <ExternalLink className="h-4 w-4 flex-shrink-0 text-muted" />
                </a>
              );
            })}
            {upcomingEvents.length === 0 && (
              <div className="rounded-lg border border-border bg-card py-10 text-center text-sm text-muted">
                近日開催のイベントはありません
              </div>
            )}
          </div>
        </div>
      </section>

      {/* 今週の応援 表彰台（likes はクライアント fetch — SSG 維持） */}
      <WeeklyCheerPodium />

      {/* 更新情報（データ更新の自動フィード・サーバーで supabaseAdmin 取得） */}
      <UpdatesNews />

    </div>
  );
}
