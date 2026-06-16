import { Metadata } from "next";
import { AnalysisSystemReport } from "./AnalysisSystemReport";
import { getSiteStats } from "@/lib/site-stats";

export const metadata: Metadata = {
  title: "システム全体構成",
  description:
    "trails.jp のシステム全体像・データソース（JOY・LapCenter・どこオリ）・収集パイプライン・DBスキーマ・分析ロジック・APIの技術ドキュメント。",
  robots: { index: false, follow: false },
};

// KPI の DB 由来値（成績レコード）を 1 日ごとに更新（トップページと共有）
export const revalidate = 86400;

export default async function AnalysisSystemDoc() {
  const buildDate = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const stats = await getSiteStats();

  return <AnalysisSystemReport buildDate={buildDate} stats={stats} />;
}
