"use client";

import { useState, useMemo } from "react";
import { CalendarDays, MapPin, ChevronLeft, ChevronRight, ExternalLink, Search, Bell, BarChart3 } from "lucide-react";
import type { JOEEvent } from "@/lib/scraper/events";

interface EventListProps {
  events: JOEEvent[];
}

const ENTRY_STYLES = {
  open: { bg: "bg-green-500/15", text: "text-green-400", label: "受付中" },
  closed: { bg: "bg-white/5", text: "text-muted", label: "締切済" },
  none: { bg: "bg-white/5", text: "text-muted", label: "-" },
};

/** 日付範囲の選択肢 */
const DATE_RANGE_OPTIONS = [
  { value: "1w", label: "過去1週間以降" },
  { value: "yesterday", label: "昨日以降" },
  { value: "1m", label: "過去1か月以降" },
  { value: "2m", label: "過去2か月以降" },
  { value: "3m", label: "過去3か月以降" },
  { value: "1y", label: "過去1年以降" },
  { value: "all", label: "すべて" },
] as const;

function getDateRangeCutoff(range: string): string {
  if (range === "all") return "";
  const now = new Date();
  switch (range) {
    case "yesterday": now.setDate(now.getDate() - 1); break;
    case "1w": now.setDate(now.getDate() - 7); break;
    case "1m": now.setMonth(now.getMonth() - 1); break;
    case "2m": now.setMonth(now.getMonth() - 2); break;
    case "3m": now.setMonth(now.getMonth() - 3); break;
    case "1y": now.setFullYear(now.getFullYear() - 1); break;
  }
  return now.toISOString().slice(0, 10);
}

export function EventList({ events }: EventListProps) {
  const [viewMode, setViewMode] = useState<"list" | "calendar">("list");
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [entryFilter, setEntryFilter] = useState("");
  const [dateRange, setDateRange] = useState("1w");
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  const allTags = useMemo(
    () => [...new Set(events.flatMap((e) => e.tags))].sort(),
    [events]
  );

  const filtered = useMemo(() => {
    const cutoff = getDateRangeCutoff(dateRange);
    return events
      .filter((e) => {
        if (cutoff && e.date < cutoff) return false;
        if (query) {
          const q = query.toLowerCase();
          if (!e.name.toLowerCase().includes(q) && !e.prefecture.includes(q)) return false;
        }
        if (tagFilter && !e.tags.includes(tagFilter)) return false;
        if (entryFilter && e.entry_status !== entryFilter) return false;
        return true;
      })
      .sort((a, b) => a.date.localeCompare(b.date) || a.joe_event_id - b.joe_event_id);
  }, [events, query, tagFilter, entryFilter, dateRange]);

  const calendarDays = useMemo(() => {
    const { year, month } = currentMonth;
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const days: (number | null)[] = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let i = 1; i <= daysInMonth; i++) days.push(i);
    return days;
  }, [currentMonth]);

  const getEventsForDay = (day: number) => {
    const { year, month } = currentMonth;
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return filtered.filter((e) => e.date === dateStr);
  };

  const eventsInMonth = useMemo(() => {
    const { year, month } = currentMonth;
    const monthStr = `${year}-${String(month + 1).padStart(2, "0")}`;
    return filtered.filter((e) => e.date.startsWith(monthStr));
  }, [filtered, currentMonth]);

  const formatDate = (d: string) => {
    const dt = new Date(d);
    const m = dt.getMonth() + 1;
    const day = dt.getDate();
    const dow = ["日", "月", "火", "水", "木", "金", "土"][dt.getDay()];
    return `${m}/${day}(${dow})`;
  };

  return (
    <div>
      {/* Controls */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
            <input
              type="text"
              placeholder="大会名・地域..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="rounded-lg border border-border bg-surface py-1.5 pl-8 pr-3 text-sm outline-none focus:border-primary"
            />
          </div>
          <select
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-primary"
          >
            <option value="">全てのタグ</option>
            {allTags.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <select
            value={entryFilter}
            onChange={(e) => setEntryFilter(e.target.value)}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-primary"
          >
            <option value="">全ての状態</option>
            <option value="open">受付中</option>
            <option value="closed">締切済</option>
          </select>
          <select
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value)}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-primary"
          >
            {DATE_RANGE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div className="flex w-fit gap-px overflow-hidden rounded-lg border border-border">
          <button
            onClick={() => setViewMode("list")}
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === "list" ? "bg-primary text-white" : "bg-card text-muted hover:text-foreground"}`}
          >
            リスト
          </button>
          <button
            onClick={() => setViewMode("calendar")}
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === "calendar" ? "bg-primary text-white" : "bg-card text-muted hover:text-foreground"}`}
          >
            カレンダー
          </button>
        </div>
      </div>

      <p className="mb-3 text-xs text-muted">{filtered.length} 件のイベント</p>

      {viewMode === "list" ? (
        <div className="space-y-2">
          {filtered.map((event) => {
            const entry = ENTRY_STYLES[event.entry_status];
            return (
              <div
                key={event.joe_event_id}
                className="flex items-center gap-4 rounded-lg border border-border bg-card p-4 transition-all hover:border-primary/30 hover:bg-card-hover"
              >
                {/* Date */}
                <div className="hidden w-16 flex-shrink-0 text-center sm:block">
                  <div className="text-lg font-bold text-primary">
                    {new Date(event.date).getMonth() + 1}/{new Date(event.date).getDate()}
                  </div>
                  <div className="text-[10px] text-muted">
                    {["日", "月", "火", "水", "木", "金", "土"][new Date(event.date).getDay()]}曜日
                  </div>
                </div>

                {/* Content */}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {event.recently_updated && (
                      <span className="inline-flex items-center gap-0.5 rounded bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-400">
                        <Bell className="h-2.5 w-2.5" />
                        {event.update_label || "更新"}
                      </span>
                    )}
                    <span className={`rounded px-2 py-0.5 text-[10px] font-medium ${entry.bg} ${entry.text}`}>
                      {entry.label}
                    </span>
                    {event.tags.map((tag) => (
                      <span key={tag} className="rounded bg-white/5 px-2 py-0.5 text-[10px] text-muted">
                        {tag}
                      </span>
                    ))}
                  </div>
                  <h3 className="mt-1.5 text-sm font-semibold">{event.name}</h3>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted">
                    <span className="flex items-center gap-1 sm:hidden">
                      <CalendarDays className="h-3 w-3" />
                      {formatDate(event.date)}
                      {event.end_date ? ` 〜 ${formatDate(event.end_date)}` : ""}
                    </span>
                    <span className="flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      {event.prefecture}
                    </span>
                  </div>
                </div>

                {/* Links */}
                <div className="flex flex-shrink-0 flex-col gap-1">
                  <a
                    href={event.joe_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs text-muted transition-colors hover:border-primary/30 hover:text-primary"
                  >
                    <ExternalLink className="h-3 w-3" />
                    <span className="hidden sm:inline">JOY</span>
                  </a>
                  {event.lapcenter_url && (
                    <a
                      href={event.lapcenter_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs text-muted transition-colors hover:border-[#00e5ff]/30 hover:text-[#00e5ff]"
                    >
                      <BarChart3 className="h-3 w-3" />
                      <span className="hidden sm:inline">Lap Center</span>
                    </a>
                  )}
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="rounded-lg border border-border bg-card py-16 text-center text-sm text-muted">
              条件に合うイベントがありません
            </div>
          )}
        </div>
      ) : (
        <div>
          <div className="mb-4 flex items-center justify-center gap-4">
            <button
              onClick={() => setCurrentMonth((p) => { const d = new Date(p.year, p.month - 1); return { year: d.getFullYear(), month: d.getMonth() }; })}
              className="rounded p-1 text-muted hover:bg-card hover:text-foreground"
            ><ChevronLeft className="h-5 w-5" /></button>
            <h2 className="text-base font-semibold">{currentMonth.year}年 {currentMonth.month + 1}月</h2>
            <button
              onClick={() => setCurrentMonth((p) => { const d = new Date(p.year, p.month + 1); return { year: d.getFullYear(), month: d.getMonth() }; })}
              className="rounded p-1 text-muted hover:bg-card hover:text-foreground"
            ><ChevronRight className="h-5 w-5" /></button>
          </div>

          <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-border bg-border">
            {["日", "月", "火", "水", "木", "金", "土"].map((d) => (
              <div key={d} className="bg-card p-2 text-center text-xs font-medium text-muted">{d}</div>
            ))}
            {calendarDays.map((day, i) => {
              const dayEvents = day ? getEventsForDay(day) : [];
              return (
                <div key={i} className={`min-h-[72px] p-1 ${day ? "bg-surface" : "bg-background"}`}>
                  {day && (
                    <>
                      <span className="text-[10px] text-muted">{day}</span>
                      {dayEvents.map((e) => (
                        <a
                          key={e.joe_event_id}
                          href={e.joe_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`mt-0.5 flex items-center gap-0.5 truncate rounded px-1 py-0.5 text-[9px] font-medium text-white hover:bg-primary/25 ${
                            e.recently_updated ? "bg-amber-500/20" : "bg-primary/15"
                          }`}
                        >
                          {e.recently_updated && <Bell className="h-2 w-2 flex-shrink-0 text-amber-400" />}
                          <span className="truncate">{e.name}</span>
                        </a>
                      ))}
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {eventsInMonth.length > 0 && (
            <div className="mt-6 space-y-1.5">
              <h3 className="mb-2 text-xs font-semibold text-muted">今月のイベント</h3>
              {eventsInMonth.map((e) => (
                <a key={e.joe_event_id} href={e.joe_url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2 rounded-lg border border-border bg-card p-2.5 text-sm transition-all hover:border-primary/30 hover:bg-card-hover">
                  <span className="font-medium text-primary">{formatDate(e.date)}</span>
                  <span className="text-white/20">|</span>
                  {e.recently_updated && (
                    <span className="inline-flex items-center gap-0.5 rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-medium text-amber-400">
                      <Bell className="h-2.5 w-2.5" />
                      {e.update_label || "更新"}
                    </span>
                  )}
                  <span className="flex-1 truncate">{e.name}</span>
                  <span className="text-xs text-muted">{e.prefecture}</span>
                  <ExternalLink className="h-3 w-3 flex-shrink-0 text-muted" />
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
