import Link from "next/link";
import { CalendarDays, Trophy, ArrowRight, ExternalLink, BarChart3 } from "lucide-react";
import type { JOEEvent } from "@/lib/scraper/events";
import eventsJson from "@/data/events.json";
import rankingsJson from "@/data/rankings.json";

export default function Home() {
  const allEvents = eventsJson as JOEEvent[];
  const now = new Date().toISOString().slice(0, 10);
  const upcomingEvents = allEvents
    .filter((e) => e.date >= now)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 4);

  const rankingAthletes = new Set(
    Object.values(rankingsJson as Record<string, { athlete_name: string }[]>)
      .flat()
      .map((e) => e.athlete_name)
  ).size;

  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border bg-surface py-16 sm:py-24">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-accent/5" />
        <div className="relative mx-auto max-w-6xl px-4 text-center">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
            日本の
            <span className="text-primary">オリエンテーリング</span>
            を、
            <br className="hidden sm:inline" />
            ひとつの場所に
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base text-muted sm:text-lg">
            大会情報・ランキング・選手分析を、見やすく一箇所に
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/events"
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-6 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-card-hover"
            >
              <CalendarDays className="h-4 w-4" />
              イベント
            </Link>
            <Link
              href="/rankings"
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-6 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-card-hover"
            >
              <Trophy className="h-4 w-4" />
              ランキング
            </Link>
            <Link
              href="/analysis"
              className="inline-flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-6 py-2.5 text-sm font-medium text-primary transition-colors hover:bg-primary/20"
            >
              <BarChart3 className="h-4 w-4" />
              選手分析
            </Link>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="border-b border-border bg-card">
        <div className="mx-auto grid max-w-6xl grid-cols-3 gap-px">
          {[
            { value: allEvents.length, label: "イベント", suffix: "件" },
            { value: rankingAthletes.toLocaleString(), label: "選手ランキング", suffix: "人" },
            { value: "47", label: "対応都道府県", suffix: "" },
          ].map((stat) => (
            <div key={stat.label} className="border-r border-border px-4 py-5 text-center last:border-r-0">
              <div className="text-2xl font-bold text-primary">
                {stat.value}
                <span className="text-sm text-muted">{stat.suffix}</span>
              </div>
              <div className="mt-1 text-xs text-muted">{stat.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="border-b border-border py-12 sm:py-16">
        <div className="mx-auto max-w-6xl px-4">
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              { icon: CalendarDays, title: "イベント", desc: "JOY連携で最新大会情報を自動取得・Lap Center連携", href: "/events", color: "text-[#00e5ff]" },
              { icon: Trophy, title: "ランキング", desc: "JOYランキング全カテゴリ対応", href: "/rankings", color: "text-[#ffab00]" },
              { icon: BarChart3, title: "選手分析", desc: "成績傾向・特性分類・クラブ統計・選手比較", href: "/analysis", color: "text-[#e040fb]" },
            ].map((f) => (
              <Link
                key={f.title}
                href={f.href}
                className="group rounded-lg border border-border bg-card p-5 transition-all hover:border-primary/30 hover:bg-card-hover"
              >
                <f.icon className={`h-8 w-8 ${f.color}`} />
                <h3 className="mt-3 text-sm font-semibold">{f.title}</h3>
                <p className="mt-1 text-xs text-muted">{f.desc}</p>
                <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
                  開く <ArrowRight className="h-3 w-3" />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

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
                    <div className="text-xl font-bold text-primary">
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

    </div>
  );
}
