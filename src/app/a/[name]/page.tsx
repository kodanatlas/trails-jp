import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import athleteIndexJson from "../../../../public/data/athlete-index.json";
import type { AthleteIndex, AthleteSummary } from "@/lib/analysis/types";
import { typeLabel } from "@/lib/analysis/utils";
import { SITE_URL } from "@/lib/site";

type Props = {
  params: Promise<{ name: string }>;
};

const athleteIndex = athleteIndexJson as unknown as AthleteIndex;

/** URL パラメータ → athlete-index キー（空白除去名）。decode 必須。不正エンコーディングは null（404 扱い） */
function resolveKey(name: string): string | null {
  try {
    return decodeURIComponent(name).replace(/\s+/g, "");
  } catch {
    // URL 切断等で % トリプレットが壊れた共有 URL は 500 ではなく 404 に落とす
    return null;
  }
}

function lookupAthlete(name: string): { key: string; summary: AthleteSummary } | null {
  const key = resolveKey(name);
  if (!key) return null;
  const summary = athleteIndex.athletes[key];
  if (!summary) return null;
  return { key, summary };
}

/** 最近の調子の符号付き表示 (+12% / -5% / ±0%) */
function formatForm(form: number): string {
  if (form > 0) return `+${form}%`;
  if (form < 0) return `${form}%`;
  return "±0%";
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { name } = await params;
  const found = lookupAthlete(name);
  if (!found) return { title: "選手が見つかりません" };

  const { key, summary } = found;
  const club = summary.clubs.length > 0 ? `所属: ${summary.clubs.join("・")}。` : "";
  const description = `${summary.name}のオリエンタイプは「${typeLabel(summary.type)}」。ベスト順位 ${summary.bestRank}位。${club}trails.jp の選手分析シェアカード。`;
  const url = `${SITE_URL}/a/${encodeURIComponent(key)}`;
  const title = `${summary.name}のオリエンタイプ`;

  return {
    title,
    description,
    openGraph: {
      title: `${title} | trails.jp`,
      description,
      url,
      siteName: "trails.jp",
      type: "profile",
    },
    twitter: {
      card: "summary_large_image",
    },
  };
}

/**
 * オリエンタイプ・シェアカードページ
 * OG カードと同等情報のライト版を表示し、/analysis への CTA を置く（自動リダイレクトはしない）
 */
export default async function AthleteSharePage({ params }: Props) {
  const { name } = await params;
  const found = lookupAthlete(name);
  if (!found) notFound();

  const { key, summary } = found;
  const totalRuns = summary.forestCount + summary.sprintCount;
  const forestPct = totalRuns > 0 ? Math.round((summary.forestCount / totalRuns) * 100) : 0;

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <div className="rounded-lg border border-border bg-card p-6 sm:p-8">
        {/* ブランド */}
        <div className="mb-6 flex items-center justify-between">
          <span className="text-sm font-bold text-primary">trails.jp</span>
          <span className="rounded bg-accent/20 px-2 py-0.5 text-[10px] font-medium text-[#00e5ff]">
            オリエンタイプ
          </span>
        </div>

        {/* 選手名・クラブ */}
        <h1 className="text-3xl font-bold sm:text-4xl">{summary.name}</h1>
        {summary.clubs.length > 0 && (
          <p className="mt-1 text-sm text-muted">{summary.clubs.join("・")}</p>
        )}

        {/* タイプ */}
        <p className="mt-5 text-2xl font-bold text-[#00e5ff] sm:text-3xl">
          {typeLabel(summary.type)}
        </p>

        {/* スタッツ */}
        <div className="mt-6 grid grid-cols-3 gap-3">
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

        {/* Forest / Sprint 出走数バー */}
        {totalRuns > 0 && (
          <div className="mt-4">
            <div className="flex items-center justify-between text-[10px] text-muted">
              <span>フォレスト {summary.forestCount}</span>
              <span>スプリント {summary.sprintCount}</span>
            </div>
            <div className="mt-1 flex h-2 overflow-hidden rounded-full bg-surface">
              <div
                className="bg-primary"
                style={{ width: `${forestPct}%` }}
              />
              <div
                className="bg-[#00e5ff]"
                style={{ width: `${100 - forestPct}%` }}
              />
            </div>
          </div>
        )}

        {/* CTA */}
        <div className="mt-8 flex flex-col gap-3">
          <Link
            href={`/analysis?athlete=${encodeURIComponent(key)}`}
            className="block rounded-lg bg-primary px-6 py-3 text-center text-base font-bold text-white transition-colors hover:bg-primary-dark"
          >
            分析ページで詳しく見る
          </Link>
          <Link
            href="/"
            className="block text-center text-xs text-muted transition-colors hover:text-foreground"
          >
            trails.jp トップへ
          </Link>
        </div>
      </div>
    </div>
  );
}
