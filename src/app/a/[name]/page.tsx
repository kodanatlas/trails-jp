import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import athleteIndexJson from "../../../../public/data/athlete-index.json";
import type { AthleteIndex, AthleteSummary } from "@/lib/analysis/types";
import { typeLabel } from "@/lib/analysis/utils";
import { SITE_URL } from "@/lib/site";
import { AthleteStandalone } from "./AthleteStandalone";

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

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { name } = await params;
  const found = lookupAthlete(name);
  if (!found) return { title: "選手が見つかりません" };

  const { key, summary } = found;
  const club = summary.clubs.length > 0 ? `所属: ${summary.clubs.join("・")}。` : "";
  const description = `${summary.name}のオリエンタイプは「${typeLabel(summary.type)}」。ベスト順位 ${summary.bestRank}位。${club}trails.jp の選手分析ページ。`;
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
 * 全1,781選手をビルド時に生成しない（opengraph-image も 1 件ずつビルドされてしまう）。
 * 空配列 + dynamicParams（既定 true）で「初回アクセス時に静的生成 → 次のデプロイまでキャッシュ」にする。
 * athlete-index はデプロイ毎に凍結（毎週水曜の再デプロイで更新）なので revalidate は不要。
 */
export function generateStaticParams(): Array<{ name: string }> {
  return [];
}

/**
 * 選手ページ（SSR）。サマリ＋OGP を初期 HTML で返し、フル分析はクライアントで読み込む。
 * 選手ページの正 URL。ハブ（/analysis）内の選手表示もアドレスバーをこの URL に正規化する。
 */
export default async function AthletePage({ params }: Props) {
  const { name } = await params;
  const key = resolveKey(name);
  if (!key) notFound();
  const summary = athleteIndex.athletes[key];
  // ランキング未収録の名前（レッグ分析・週末ハイライト等からのリンク）は検索プリフィルへ誘導
  if (!summary) redirect(`/analysis?q=${encodeURIComponent(key)}`);
  return <AthleteStandalone summary={summary} />;
}
