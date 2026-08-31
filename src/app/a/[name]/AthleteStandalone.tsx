"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import type { AthleteIndex, AthleteSummary } from "@/lib/analysis/types";
import { hasMergedNamesakes } from "@/lib/analysis/head-to-head";
import { typeLabel } from "@/lib/analysis/utils";
import { AthleteDetail } from "@/app/analysis/AthleteDetail";

/** 最近の調子の符号付き表示 (+12% / -5% / ±0%) */
function formatForm(form: number): string {
  if (form > 0) return `+${form}%`;
  if (form < 0) return `${form}%`;
  return "±0%";
}

/**
 * /a/[name] のクライアント本体。
 * サマリはサーバーから props で受け取る（＝SSR され、初期 HTML に選手名＋要約が必ず入る）。
 * athlete-index(1.9MB) 到着後にサマリカードをフル分析（AthleteDetail）へ差し替える。
 * 選手名・クラブは常設ヘッダーとして残し、ロード中も選手名が消えないようにする。
 */
export function AthleteStandalone({ summary }: { summary: AthleteSummary }) {
  const [athleteIndex, setAthleteIndex] = useState<AthleteIndex | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/data/athlete-index.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((ai: AthleteIndex) => {
        if (!cancelled) setAthleteIndex(ai);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const totalRuns = summary.forestCount + summary.sprintCount;
  const forestPct = totalRuns > 0 ? Math.round((summary.forestCount / totalRuns) * 100) : 0;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      {/* 常設ヘッダー: 選手名・クラブ */}
      <div className="mb-1 flex items-center gap-2">
        <h1 className="text-2xl font-bold">{summary.name}</h1>
        <span className="rounded bg-accent/20 px-2 py-0.5 text-[10px] font-medium text-[#00e5ff]">
          選手分析
        </span>
      </div>
      {summary.clubs.length > 0 && (
        <p className="text-xs text-muted">{summary.clubs.join(" / ")}</p>
      )}
      {hasMergedNamesakes(summary) && (
        <p className="mt-2 rounded bg-amber-500/10 px-2 py-1 text-[10px] text-amber-300/90">
          ※ このページには同姓同名の別人の成績が混在している可能性があります（複数の所属が表示されている場合は特にご注意ください）
        </p>
      )}

      <div className="mt-5">
        {athleteIndex ? (
          <AthleteDetail summary={summary} athleteIndex={athleteIndex} />
        ) : (
          <>
            {/* index 到着までのサマリカード（SSR されるため初期 HTML・クローラにも載る） */}
            <div className="rounded-lg border border-border bg-card p-6">
              <p className="text-[10px] text-muted">オリエンタイプ</p>
              <p className="mt-1 text-xl font-bold text-[#00e5ff] sm:text-2xl">
                {typeLabel(summary.type)}
              </p>

              <div className="mt-5 grid grid-cols-3 gap-3">
                <div className="rounded-lg bg-surface p-3 text-center">
                  <p className="text-[10px] text-muted">ベスト順位</p>
                  <p className="mt-1 text-xl font-bold">{summary.bestRank}位</p>
                </div>
                <div className="rounded-lg bg-surface p-3 text-center">
                  <p className="text-[10px] text-muted">最近の調子</p>
                  <p
                    className={`mt-1 text-xl font-bold ${
                      summary.recentForm > 0
                        ? "text-green-400"
                        : summary.recentForm < 0
                          ? "text-red-400"
                          : ""
                    }`}
                  >
                    {formatForm(summary.recentForm)}
                  </p>
                </div>
                <div className="rounded-lg bg-surface p-3 text-center">
                  <p className="text-[10px] text-muted">出走数</p>
                  <p className="mt-1 text-xl font-bold">{totalRuns}</p>
                </div>
              </div>

              {totalRuns > 0 && (
                <div className="mt-4">
                  <div className="flex items-center justify-between text-[10px] text-muted">
                    <span>フォレスト {summary.forestCount}</span>
                    <span>スプリント {summary.sprintCount}</span>
                  </div>
                  <div className="mt-1 flex h-2 overflow-hidden rounded-full bg-surface">
                    <div className="bg-primary" style={{ width: `${forestPct}%` }} />
                    <div className="bg-[#00e5ff]" style={{ width: `${100 - forestPct}%` }} />
                  </div>
                </div>
              )}
            </div>

            {failed ? (
              <p className="mt-5 rounded-lg border border-border bg-card py-6 text-center text-sm text-muted">
                詳細データの読み込みに失敗しました。再読み込みしてください。
              </p>
            ) : (
              <div className="mt-5 flex items-center justify-center py-8">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span className="ml-2 text-sm text-muted">詳細データを読み込み中...</span>
              </div>
            )}
          </>
        )}
      </div>

      <p className="mt-8 text-center text-xs text-muted">
        <Link href="/analysis" className="text-primary hover:underline">
          選手分析ハブ
        </Link>
        で他の選手の検索・クラブ分析・比較ができます
      </p>
    </div>
  );
}
