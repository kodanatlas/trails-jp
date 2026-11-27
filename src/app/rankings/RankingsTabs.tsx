"use client";

import { useState, type ReactNode } from "react";

/** ランキングページの上段タブ（JOY ランキング／ルーキーリーグ） */
export function RankingsTabs({ joy, rookie }: { joy: ReactNode; rookie: ReactNode }) {
  const [tab, setTab] = useState<"joy" | "rookie">("joy");
  const tabs = [
    { key: "joy" as const, label: "JOY ランキング" },
    { key: "rookie" as const, label: "ルーキーリーグ（B）" },
  ];
  return (
    <div>
      <div className="mb-5 flex gap-4 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 pb-2 text-sm font-medium ${tab === t.key ? "border-primary text-foreground" : "border-transparent text-muted hover:text-foreground"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "joy" ? joy : rookie}
    </div>
  );
}
