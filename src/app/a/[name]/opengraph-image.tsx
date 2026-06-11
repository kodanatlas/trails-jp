import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import athleteIndexJson from "../../../../public/data/athlete-index.json";
import type { AthleteIndex } from "@/lib/analysis/types";
import { typeLabel } from "@/lib/analysis/utils";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "オリエンタイプ・シェアカード | trails.jp";

const athleteIndex = athleteIndexJson as unknown as AthleteIndex;

// 日本語サブセットフォントは module スコープで一度だけ読み込む
const fontPromise = readFile(
  join(process.cwd(), "assets/fonts/NotoSansJP-subset.otf")
);

/** 最近の調子の符号付き表示 */
function formatForm(form: number): string {
  if (form > 0) return `+${form}%`;
  if (form < 0) return `${form}%`;
  return "±0%";
}

export default async function Image({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  let key = "";
  try {
    key = decodeURIComponent(name).replace(/\s+/g, "");
  } catch {
    // 不正な percent-encoding は不在選手と同じ汎用ブランドカードに落とす
  }
  const summary = athleteIndex.athletes[key];
  const fontData = await fontPromise;

  const fonts = [
    {
      name: "NotoSansJP",
      data: fontData,
      weight: 700 as const,
      style: "normal" as const,
    },
  ];

  // 不在選手はブランドのみの汎用カード
  if (!summary) {
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "#0f1720",
            fontFamily: "NotoSansJP",
          }}
        >
          <div style={{ display: "flex", fontSize: 72, fontWeight: 700, color: "#f97316" }}>
            trails.jp
          </div>
          <div style={{ display: "flex", marginTop: 24, fontSize: 32, color: "#8a9bb0" }}>
            日本オリエンテーリング統合プラットフォーム
          </div>
        </div>
      ),
      { ...size, fonts }
    );
  }

  const totalRuns = summary.forestCount + summary.sprintCount;
  const forestPct =
    totalRuns > 0 ? Math.round((summary.forestCount / totalRuns) * 100) : 0;
  const formColor =
    summary.recentForm > 0
      ? "#4ade80"
      : summary.recentForm < 0
        ? "#f87171"
        : "#e8eaed";

  const stats = [
    { label: "ベスト順位", value: `${summary.bestRank}位`, color: "#e8eaed" },
    { label: "最近の調子", value: formatForm(summary.recentForm), color: formColor },
    {
      label: "フォレスト / スプリント",
      value: `${summary.forestCount} / ${summary.sprintCount}`,
      color: "#e8eaed",
    },
  ];

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "#0f1720",
          padding: "56px 72px",
          fontFamily: "NotoSansJP",
        }}
      >
        {/* ヘッダー: ブランド */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", fontSize: 40, fontWeight: 700, color: "#f97316" }}>
            trails.jp
          </div>
          <div style={{ display: "flex", fontSize: 28, color: "#8a9bb0" }}>
            オリエンタイプ
          </div>
        </div>

        {/* 中央: 選手名・クラブ・タイプ */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flexGrow: 1,
            justifyContent: "center",
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: 84,
              fontWeight: 700,
              color: "#ffffff",
              lineHeight: 1.1,
            }}
          >
            {summary.name}
          </div>
          {summary.clubs.length > 0 && (
            <div
              style={{
                display: "flex",
                marginTop: 12,
                fontSize: 30,
                color: "#8a9bb0",
              }}
            >
              {summary.clubs.join("・")}
            </div>
          )}
          <div
            style={{
              display: "flex",
              marginTop: 28,
              fontSize: 64,
              fontWeight: 700,
              color: "#00e5ff",
            }}
          >
            {typeLabel(summary.type)}
          </div>
        </div>

        {/* 下部: 3スタッツ＋F/Sバー */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", gap: 20 }}>
            {stats.map((s) => (
              <div
                key={s.label}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  flexGrow: 1,
                  flexBasis: 0,
                  backgroundColor: "#1a2332",
                  borderRadius: 12,
                  padding: "20px 28px",
                }}
              >
                <div style={{ display: "flex", fontSize: 22, color: "#8a9bb0" }}>
                  {s.label}
                </div>
                <div
                  style={{
                    display: "flex",
                    marginTop: 8,
                    fontSize: 40,
                    fontWeight: 700,
                    color: s.color,
                  }}
                >
                  {s.value}
                </div>
              </div>
            ))}
          </div>
          {totalRuns > 0 && (
            <div
              style={{
                display: "flex",
                marginTop: 20,
                height: 14,
                borderRadius: 7,
                overflow: "hidden",
                backgroundColor: "#151e2b",
              }}
            >
              <div
                style={{
                  display: "flex",
                  width: `${forestPct}%`,
                  backgroundColor: "#f97316",
                }}
              />
              <div
                style={{
                  display: "flex",
                  width: `${100 - forestPct}%`,
                  backgroundColor: "#00e5ff",
                }}
              />
            </div>
          )}
        </div>
      </div>
    ),
    { ...size, fonts }
  );
}
