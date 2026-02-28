"use client";

import { useState, useEffect, useMemo } from "react";
import { Search, User, Users, GitCompareArrows, Loader2, ArrowLeft } from "lucide-react";
import type { AthleteIndex, ClubIndex, AthleteSummary } from "@/lib/analysis/types";
import { AthleteDetail } from "./AthleteDetail";
import { ClubAnalysis } from "./ClubAnalysis";
import { CompareAthletes } from "./CompareAthletes";
import { AthleteDistribution } from "./DistributionCharts";

type Tab = "athlete" | "clubs" | "compare";

const tabs: { id: Tab; label: string; icon: typeof User }[] = [
  { id: "athlete", label: "選手分析", icon: User },
  { id: "clubs", label: "クラブ", icon: Users },
  { id: "compare", label: "比較", icon: GitCompareArrows },
];

export function AnalysisHub() {
  const [activeTab, setActiveTab] = useState<Tab>("athlete");
  const [athleteIndex, setAthleteIndex] = useState<AthleteIndex | null>(null);
  const [clubIndex, setClubIndex] = useState<ClubIndex | null>(null);
  const [loading, setLoading] = useState(true);

  // 選手検索
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedAthlete, setSelectedAthlete] = useState<AthleteSummary | null>(null);

  // クラブから選手へ遷移した場合の戻り先
  const [fromClub, setFromClub] = useState<string | null>(null);

  // 比較用
  const [compareA, setCompareA] = useState<AthleteSummary | null>(null);
  const [compareB, setCompareB] = useState<AthleteSummary | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/data/athlete-index.json").then((r) => r.json()),
      fetch("/data/club-stats.json").then((r) => r.json()),
    ]).then(([ai, ci]) => {
      setAthleteIndex(ai);
      setClubIndex(ci);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const searchResults = useMemo(() => {
    if (!athleteIndex || !searchQuery) return [];
    const isAsciiOnly = /^[\x00-\x7F]+$/.test(searchQuery);
    if (isAsciiOnly && searchQuery.length < 2) return [];
    const q = searchQuery.toLowerCase();
    return Object.values(athleteIndex.athletes)
      .filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          a.clubs.some((c) => c.toLowerCase().includes(q))
      )
      .sort((a, b) => a.bestRank - b.bestRank)
      .slice(0, 20);
  }, [athleteIndex, searchQuery]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        <span className="ml-2 text-sm text-muted">データを読み込み中...</span>
      </div>
    );
  }

  if (!athleteIndex || !clubIndex) {
    return (
      <div className="rounded-lg border border-border bg-card py-16 text-center text-sm text-muted">
        分析データの読み込みに失敗しました
      </div>
    );
  }

  return (
    <div>
      {/* Tab Bar */}
      <div className="mb-5 flex gap-1.5">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => {
              setActiveTab(tab.id);
              setSelectedAthlete(null);
              setSearchQuery("");
              setFromClub(null);
            }}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTab === tab.id
                ? "bg-primary text-white"
                : "border border-border text-muted hover:text-foreground"
            }`}
          >
            <tab.icon className="h-3.5 w-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Athlete Tab */}
      {activeTab === "athlete" && (
        <div>
          {/* Search */}
          <div className="relative mb-4">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
            <input
              type="text"
              placeholder="選手名またはクラブ名で検索..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSelectedAthlete(null);
              }}
              className="w-full rounded-lg border border-border bg-surface py-2 pl-8 pr-3 text-sm outline-none focus:border-primary"
            />
          </div>

          {/* Search Results */}
          {searchQuery.length >= 1 && !selectedAthlete && searchResults.length >= 0 && (
            <div className="mb-4 space-y-1">
              {searchResults.length === 0 && (
                <p className="py-8 text-center text-sm text-muted">該当する選手がいません</p>
              )}
              {searchResults.map((a) => (
                <button
                  key={a.name}
                  onClick={() => {
                    setSelectedAthlete(a);
                    setSearchQuery(a.name);
                  }}
                  className="flex w-full items-center gap-3 rounded-lg border border-border bg-card p-3 text-left transition-all hover:border-primary/30 hover:bg-card-hover"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                    {a.bestRank}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{a.name}</p>
                    <p className="truncate text-xs text-muted">{a.clubs.join(" / ")}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-sm font-bold text-primary">
                      {a.bestPoints.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                    </p>
                    <p className="text-[10px] text-muted">
                      {a.appearances.length} カテゴリ
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Athlete Detail */}
          {selectedAthlete && (
            <>
              {fromClub && (
                <button
                  onClick={() => {
                    setActiveTab("clubs");
                    setSelectedAthlete(null);
                    setSearchQuery("");
                  }}
                  className="mb-3 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-muted transition-colors hover:bg-card hover:text-foreground"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  {fromClub} に戻る
                </button>
              )}
              <AthleteDetail summary={selectedAthlete} />
            </>
          )}

          {/* Distribution chart (shown when no search or when athlete selected) */}
          {(!searchQuery || selectedAthlete) && (
            <div className="mt-4">
              <AthleteDistribution
                athleteIndex={athleteIndex}
                selectedAthlete={selectedAthlete}
              />
            </div>
          )}
        </div>
      )}

      {/* Clubs Tab */}
      {activeTab === "clubs" && (
        <ClubAnalysis
          clubIndex={clubIndex}
          athleteIndex={athleteIndex}
          initialExpandedClub={fromClub}
          onSelectAthlete={(name, clubName) => {
            const athlete = athleteIndex.athletes[name];
            if (athlete) {
              setFromClub(clubName ?? null);
              setActiveTab("athlete");
              setSearchQuery(name);
              setSelectedAthlete(athlete);
            }
          }}
        />
      )}

      {/* Compare Tab */}
      {activeTab === "compare" && (
        <CompareAthletes
          athleteIndex={athleteIndex}
          compareA={compareA}
          compareB={compareB}
          onSelectA={setCompareA}
          onSelectB={setCompareB}
        />
      )}
    </div>
  );
}
