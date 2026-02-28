"use client";

import { useState, useMemo } from "react";
import { Search, ChevronDown, ChevronUp, Users, TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { AthleteIndex, ClubIndex, ClubProfile, ClubMember } from "@/lib/analysis/types";
import { typeLabel } from "@/lib/analysis/utils";
import { ClubDistribution } from "./DistributionCharts";

type SortKey = "members" | "avgPoints" | "active";

const INITIAL_SHOW = 5;

interface Props {
  clubIndex: ClubIndex;
  athleteIndex: AthleteIndex;
  onSelectAthlete?: (name: string, clubName?: string) => void;
  initialExpandedClub?: string | null;
}

const typeBadgeColors: Record<string, string> = {
  sprinter: "bg-blue-500/15 text-blue-400",
  forester: "bg-green-500/15 text-green-400",
  allrounder: "bg-purple-500/15 text-purple-400",
  unknown: "bg-white/10 text-muted",
};

export function ClubAnalysis({ clubIndex, onSelectAthlete, initialExpandedClub }: Props) {
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("active");
  const [expandedClub, setExpandedClub] = useState<string | null>(initialExpandedClub ?? null);

  const clubs = useMemo(() => {
    let list = Object.values(clubIndex.clubs);

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter((c) =>
        c.name.toLowerCase().includes(q) ||
        c.members.some((m) => m.name.toLowerCase().includes(q))
      );
    }

    list.sort((a, b) => {
      switch (sortBy) {
        case "members": return b.memberCount - a.memberCount;
        case "avgPoints": return b.avgPoints - a.avgPoints;
        case "active": return b.activeCount - a.activeCount;
      }
    });

    return list;
  }, [clubIndex, searchQuery, sortBy]);

  return (
    <div>
      {/* Search + Sort */}
      <div className="mb-4 flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
          <input
            type="text"
            placeholder="クラブ名・選手名で検索..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface py-2 pl-8 pr-3 text-sm outline-none focus:border-primary"
          />
        </div>
        <div className="flex gap-1">
          {([
            { key: "members" as SortKey, label: "人数" },
            { key: "avgPoints" as SortKey, label: "平均点" },
            { key: "active" as SortKey, label: "アクティブ" },
          ]).map((s) => (
            <button
              key={s.key}
              onClick={() => setSortBy(s.key)}
              className={`rounded px-2 py-1 text-[11px] font-medium transition-colors ${
                sortBy === s.key
                  ? "bg-primary/20 text-primary"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Distribution chart */}
      <div className="mb-5">
        <ClubDistribution clubIndex={clubIndex} expandedClub={expandedClub} />
      </div>

      <p className="mb-3 text-xs text-muted">
        {clubs.length} クラブ / 全 {Object.keys(clubIndex.clubs).length} クラブ
      </p>

      {/* Club List */}
      <div className="space-y-1.5">
        {clubs.slice(0, 50).map((club) => (
          <ClubCard
            key={club.name}
            club={club}
            isExpanded={expandedClub === club.name}
            onToggle={() =>
              setExpandedClub(expandedClub === club.name ? null : club.name)
            }
            onSelectAthlete={onSelectAthlete}
          />
        ))}
        {clubs.length > 50 && (
          <p className="py-4 text-center text-xs text-muted">
            上位50クラブを表示中。検索で絞り込んでください。
          </p>
        )}
      </div>
    </div>
  );
}

function ClubCard({
  club,
  isExpanded,
  onToggle,
  onSelectAthlete,
}: {
  club: ClubProfile;
  isExpanded: boolean;
  onToggle: () => void;
  onSelectAthlete?: (name: string, clubName?: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const totalType = club.forestCount + club.sprintCount;

  const visibleMembers = showAll
    ? club.members
    : club.members.slice(0, INITIAL_SHOW);
  const hasMore = club.members.length > INITIAL_SHOW;

  return (
    <div>
      <button
        onClick={onToggle}
        className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-all ${
          isExpanded
            ? "border-primary/30 bg-card-hover"
            : "border-border bg-card hover:border-primary/20 hover:bg-card-hover"
        }`}
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
          <Users className="h-4 w-4 text-primary" />
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{club.name}</p>
          <p className="text-[10px] text-muted">
            {club.memberCount}名 · アクティブ {club.activeCount}名
          </p>
        </div>

        {/* Type distribution mini bar */}
        {totalType > 0 && (
          <div className="hidden w-20 sm:block">
            <div className="flex h-1.5 overflow-hidden rounded-full">
              <div
                className="bg-green-500/60"
                style={{ width: `${(club.forestCount / totalType) * 100}%` }}
              />
              <div
                className="bg-blue-500/60"
                style={{ width: `${(club.sprintCount / totalType) * 100}%` }}
              />
            </div>
            <div className="mt-0.5 flex justify-between text-[8px] text-muted">
              <span>F</span>
              <span>S</span>
            </div>
          </div>
        )}

        <span className="font-mono text-sm font-bold text-primary">
          {club.avgPoints.toLocaleString(undefined, { maximumFractionDigits: 1 })}
        </span>

        {isExpanded ? (
          <ChevronUp className="h-4 w-4 flex-shrink-0 text-muted" />
        ) : (
          <ChevronDown className="h-4 w-4 flex-shrink-0 text-muted" />
        )}
      </button>

      {isExpanded && (
        <div className="ml-11 mt-1 rounded-lg border border-border bg-surface p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
              メンバー ({club.members.length}名)
            </span>
            <div className="flex gap-4 text-[10px] text-muted">
              <span className="flex items-center gap-1">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-400" /> Forest {club.forestCount}
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-400" /> Sprint {club.sprintCount}
              </span>
            </div>
          </div>

          {/* Column headers */}
          <div className="flex items-center gap-1.5 px-2 pb-1 text-[9px] font-semibold uppercase tracking-wider text-muted/60">
            <span className="w-7 flex-shrink-0 text-center">順位</span>
            <span className="min-w-0 flex-1">名前</span>
            <span className="flex-shrink-0 w-12 text-center">特性</span>
            <span className="w-10 flex-shrink-0 text-right">調子</span>
            <span className="hidden w-8 flex-shrink-0 text-center sm:block">安定</span>
            <span className="hidden w-8 flex-shrink-0 text-right sm:block">大会</span>
            <span className="w-14 flex-shrink-0 text-right">ポイント</span>
          </div>

          <div className="space-y-1">
            {visibleMembers.map((m) => (
              <MemberRow key={m.name} member={m} onSelect={(name) => onSelectAthlete?.(name, club.name)} />
            ))}
          </div>

          {hasMore && (
            <button
              onClick={() => setShowAll(!showAll)}
              className="mt-2 flex w-full items-center justify-center gap-1 rounded bg-white/[0.03] py-1.5 text-[11px] font-medium text-muted transition-colors hover:bg-white/[0.06] hover:text-foreground"
            >
              {showAll ? (
                <>
                  <ChevronUp className="h-3 w-3" />
                  上位{INITIAL_SHOW}名のみ表示
                </>
              ) : (
                <>
                  <ChevronDown className="h-3 w-3" />
                  残り{club.members.length - INITIAL_SHOW}名を表示
                </>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function MemberRow({ member: m, onSelect }: { member: ClubMember; onSelect?: (name: string) => void }) {
  return (
    <button
      onClick={() => onSelect?.(m.name)}
      className="flex w-full items-center gap-1.5 rounded bg-white/[0.03] p-2 text-left transition-colors hover:bg-white/[0.08]">
      {/* Rank */}
      <span className="w-7 flex-shrink-0 text-center text-xs font-bold text-primary">
        {m.bestRank}
      </span>

      {/* Name + class */}
      <div className="min-w-0 flex-1">
        <span className="truncate text-sm">{m.name}</span>
        <span className="ml-1.5 text-[9px] text-muted">{m.className}</span>
      </div>

      {/* Type badge */}
      <span className={`flex-shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold ${typeBadgeColors[m.athleteType]}`}>
        {typeLabel(m.athleteType)}
      </span>

      {/* Recent form arrow */}
      <span className="flex w-10 flex-shrink-0 items-center justify-end gap-0.5">
        {m.recentForm > 3 ? (
          <TrendingUp className="h-3 w-3 text-green-400" />
        ) : m.recentForm < -3 ? (
          <TrendingDown className="h-3 w-3 text-red-400" />
        ) : (
          <Minus className="h-3 w-3 text-muted/50" />
        )}
        <span className={`text-[9px] font-mono font-bold ${
          m.recentForm > 3 ? "text-green-400" : m.recentForm < -3 ? "text-red-400" : "text-muted/50"
        }`}>
          {m.recentForm > 0 ? "+" : ""}{m.recentForm}%
        </span>
      </span>

      {/* Consistency */}
      <span className="hidden w-8 flex-shrink-0 sm:block" title="安定性">
        {m.eventCount < 2 ? (
          <span className="text-[9px] text-muted/40">—</span>
        ) : (
          <span className={`text-[9px] font-mono font-bold ${
            m.consistency >= 70 ? "text-green-400" : m.consistency >= 40 ? "text-yellow-400/80" : "text-red-400/70"
          }`}>
            {m.consistency}
          </span>
        )}
      </span>

      {/* Event count */}
      <span className="hidden w-8 flex-shrink-0 text-right text-[9px] text-muted sm:block" title="大会数">
        {m.eventCount}大会
      </span>

      {/* Points */}
      <span className="w-14 flex-shrink-0 text-right font-mono text-xs font-bold text-primary">
        {m.bestPoints.toLocaleString(undefined, { maximumFractionDigits: 1 })}
      </span>
    </button>
  );
}
