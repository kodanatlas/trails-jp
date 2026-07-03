"use client";

import { useState, useMemo, useCallback } from "react";
import Link from "next/link";
import { CalendarDays, MapPin, ChevronLeft, ChevronRight, ChevronDown, ExternalLink, Search, Bell, BarChart3, ListChecks, Users, Loader2, Route } from "lucide-react";
import type { JOEEvent } from "@/lib/scraper/events";
import type { EntryListResult } from "@/lib/scraper/entries";

/** エントリーリストを表示する対象かどうかの判定（受付中 or 直近 N 日以内の大会） */
const ENTRY_LIST_RECENT_DAYS = 30;

function canShowEntries(e: JOEEvent): boolean {
  if (e.entry_status === "open") return true;
  if (!e.date) return false;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - ENTRY_LIST_RECENT_DAYS);
  return e.date >= cutoff.toISOString().slice(0, 10);
}

type EntryState = EntryListResult | "loading" | "error" | undefined;

interface EventListProps {
  events: JOEEvent[];
}

const ENTRY_STYLES = {
  open: { bg: "bg-green-500/15", text: "text-green-400", label: "受付中" },
  closed: { bg: "bg-white/5", text: "text-muted", label: "締切済" },
  none: { bg: "", text: "", label: "" },
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
  const [dateRange, setDateRange] = useState("yesterday");
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  // エントリーリスト（所属別グループ）の開閉・キャッシュ
  const [openEntryEvents, setOpenEntryEvents] = useState<Set<number>>(new Set());
  const [entryCache, setEntryCache] = useState<Record<number, EntryState>>({});
  const [openTeams, setOpenTeams] = useState<Set<string>>(new Set());

  const toggleEntry = useCallback(
    (eventId: number) => {
      setOpenEntryEvents((prev) => {
        const next = new Set(prev);
        if (next.has(eventId)) {
          next.delete(eventId);
        } else {
          next.add(eventId);
          // 未取得ならオンデマンドで取得
          setEntryCache((cache) => {
            if (cache[eventId] !== undefined) return cache;
            fetch(`/api/events/${eventId}/entries`)
              .then((r) => r.json())
              .then((data: EntryListResult) =>
                setEntryCache((c) => ({ ...c, [eventId]: data }))
              )
              .catch(() => setEntryCache((c) => ({ ...c, [eventId]: "error" })));
            return { ...cache, [eventId]: "loading" };
          });
        }
        return next;
      });
    },
    []
  );

  const toggleTeam = useCallback((eventId: number, affiliation: string) => {
    const key = `${eventId}:${affiliation}`;
    setOpenTeams((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

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
                className="overflow-hidden rounded-lg border border-border bg-card transition-all hover:border-primary/30"
              >
                <div className="flex items-center gap-4 p-4 transition-colors hover:bg-card-hover">
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
                    {event.tags.map((tag) => (
                      <span key={tag} className="rounded bg-white/5 px-2 py-0.5 text-[10px] text-muted">
                        {tag}
                      </span>
                    ))}
                    {entry.label && (
                      <span className={`rounded px-2 py-0.5 text-[10px] font-medium ${entry.bg} ${entry.text}`}>
                        {entry.label}
                      </span>
                    )}
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
                  {event.lapcenter_event_id != null && (
                    <Link
                      href={`/results/${event.lapcenter_event_id}`}
                      className="flex items-center gap-1 rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
                    >
                      <Route className="h-3 w-3" />
                      <span className="hidden sm:inline">結果分析</span>
                    </Link>
                  )}
                </div>
                </div>
                {canShowEntries(event) && (
                  <EventEntries
                    eventId={event.joe_event_id}
                    isOpen={openEntryEvents.has(event.joe_event_id)}
                    state={entryCache[event.joe_event_id]}
                    openTeams={openTeams}
                    onToggle={toggleEntry}
                    onToggleTeam={toggleTeam}
                  />
                )}
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

interface EventEntriesProps {
  eventId: number;
  isOpen: boolean;
  state: EntryState;
  openTeams: Set<string>;
  onToggle: (eventId: number) => void;
  onToggleTeam: (eventId: number, affiliation: string) => void;
}

/** イベントカードに付随するエントリーリスト（所属一覧 → エントリー者の2段アコーディオン） */
function EventEntries({ eventId, isOpen, state, openTeams, onToggle, onToggleTeam }: EventEntriesProps) {
  const loaded = state && state !== "loading" && state !== "error" ? state : null;

  return (
    <div className="border-t border-border">
      <button
        onClick={() => onToggle(eventId)}
        className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-xs font-medium text-muted transition-colors hover:bg-card-hover hover:text-foreground"
        aria-expanded={isOpen}
      >
        <span className="flex items-center gap-1.5">
          <ListChecks className="h-3.5 w-3.5" />
          エントリーリスト
          {loaded && <span className="font-semibold text-[#00e5ff]">{loaded.total}人</span>}
        </span>
        <ChevronDown className={`h-4 w-4 flex-shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {isOpen && (
        <div className="px-4 pb-3">
          {state === "loading" && (
            <p className="flex items-center gap-1.5 py-3 text-xs text-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              読み込み中...
            </p>
          )}
          {state === "error" && (
            <p className="py-3 text-xs text-red-400">エントリーリストを取得できませんでした</p>
          )}
          {loaded && loaded.teams.length === 0 && (
            <p className="py-3 text-xs text-muted">エントリーはまだありません</p>
          )}
          {loaded && loaded.teams.length > 0 && (
            <div className="space-y-1">
              {loaded.teams.map((team) => {
                const teamKey = `${eventId}:${team.affiliation}`;
                const teamOpen = openTeams.has(teamKey);
                return (
                  <div key={teamKey} className="overflow-hidden rounded-md border border-border/60 bg-surface">
                    <button
                      onClick={() => onToggleTeam(eventId, team.affiliation)}
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-card-hover"
                      aria-expanded={teamOpen}
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        <ChevronRight className={`h-3 w-3 flex-shrink-0 text-muted transition-transform ${teamOpen ? "rotate-90" : ""}`} />
                        <Users className="h-3 w-3 flex-shrink-0 text-muted" />
                        <span className="truncate font-medium">{team.affiliation}</span>
                      </span>
                      <span className="flex-shrink-0 rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-muted">
                        {team.count}人
                      </span>
                    </button>
                    {teamOpen && (
                      <ul className="border-t border-border/60 px-3 py-1">
                        {team.entries.map((entry, i) => (
                          <li key={i} className="flex items-center gap-2 py-1 text-xs">
                            <span className="w-16 flex-shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-center text-[10px] font-medium text-primary">
                              {entry.className || "-"}
                            </span>
                            <span className="flex-shrink-0">{entry.name}</span>
                            {entry.affiliation && (
                              <span className="min-w-0 truncate text-[10px] text-muted">{entry.affiliation}</span>
                            )}
                            {entry.members && (
                              <span className="flex-shrink-0 truncate text-[10px] text-muted">（{entry.members}）</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
