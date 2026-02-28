import type { Metadata } from "next";
import { AnalysisHub } from "./AnalysisHub";

export const metadata: Metadata = {
  title: "分析",
  description: "ランキングデータを元にした選手分析・クラブ分析・選手比較。",
};

export default function AnalysisPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-1 flex items-center gap-2">
        <h1 className="text-2xl font-bold">分析</h1>
        <span className="rounded bg-accent/20 px-2 py-0.5 text-[10px] font-medium text-[#00e5ff]">
          JOY データ
        </span>
      </div>
      <p className="mb-6 text-xs text-muted">
        ランキングデータを元にした選手の傾向分析・特性分類・クラブ統計・選手比較
      </p>
      <AnalysisHub />
    </div>
  );
}
