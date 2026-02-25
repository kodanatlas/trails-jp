import type { Metadata } from "next";
import { RANKING_CONFIGS } from "@/lib/scraper/rankings";
import { RankingView } from "./RankingView";

export const metadata: Metadata = {
  title: "ランキング",
  description: "JOYと連携したオリエンテーリング日本ランキング。",
};

export default function RankingsPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-1 flex items-center gap-2">
        <h1 className="text-2xl font-bold">ランキング</h1>
        <span className="rounded bg-accent/20 px-2 py-0.5 text-[10px] font-medium text-[#00e5ff]">
          JOY 連携
        </span>
      </div>
      <p className="mb-6 text-xs text-muted">
        JOY から週次（水曜 03:00 JST）自動取得。
      </p>
      <RankingView rankingConfigs={RANKING_CONFIGS} />
    </div>
  );
}
