import type { Metadata } from "next";
import * as fs from "fs";
import * as path from "path";
import { AdjustedDetail, type LiveAdjustment } from "./AdjustedDetail";

export const metadata: Metadata = {
  title: "補正済みポイントの詳細",
  description:
    "trails.jp の補正済みポイントで、スプリントの得点をどう補正しているか（同一選手の実測・水準別の差し引き量・対象大会・検証結果）の詳しい説明。",
  robots: { index: false, follow: false },
};

// 現在の値はビルド時の athlete-index.json から読む（ランキング更新＝ビルドのたびに更新される）
export const dynamic = "force-static";

function readLiveAdjustment(): LiveAdjustment | null {
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), "public/data/athlete-index.json"), "utf-8");
    const idx = JSON.parse(raw) as {
      adjustment?: { windowStart: string; nodes: { pct: number; gap: number }[]; pairedCount: number };
      generatedAt?: string;
    };
    if (!idx.adjustment) return null;
    return { ...idx.adjustment, generatedAt: idx.generatedAt ?? null };
  } catch {
    return null;
  }
}

export default function AdjustedDetailPage() {
  return <AdjustedDetail live={readLiveAdjustment()} />;
}
