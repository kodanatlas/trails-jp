import type { MetadataRoute } from "next";
import athleteIndexJson from "../../public/data/athlete-index.json";
import type { AthleteIndex } from "@/lib/analysis/types";
import { SITE_URL } from "@/lib/site";

const athleteIndex = athleteIndexJson as unknown as AthleteIndex;

/**
 * 静的ページ＋全選手ページ（/a/<key>）のサイトマップ。
 * athlete-index はビルド時に凍結されるためビルド時静的生成でよい（毎週水曜の再デプロイで更新）。
 * 除外: `_` プレフィックス（非ルーティング）・admin・carpool（ツール）・results/go（リダイレクタ）・動的 results/events 配下。
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date(athleteIndex.generatedAt);

  const staticPages: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, lastModified, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_URL}/events`, lastModified, changeFrequency: "daily", priority: 0.8 },
    { url: `${SITE_URL}/rankings`, lastModified, changeFrequency: "weekly", priority: 0.8 },
    { url: `${SITE_URL}/analysis`, lastModified, changeFrequency: "weekly", priority: 0.8 },
    { url: `${SITE_URL}/results`, lastModified, changeFrequency: "daily", priority: 0.7 },
    { url: `${SITE_URL}/docs/analysis-system`, lastModified, changeFrequency: "monthly", priority: 0.4 },
    { url: `${SITE_URL}/about`, lastModified, changeFrequency: "monthly", priority: 0.3 },
    { url: `${SITE_URL}/contact`, lastModified, changeFrequency: "monthly", priority: 0.3 },
  ];

  const athletePages: MetadataRoute.Sitemap = Object.keys(athleteIndex.athletes).map(
    (key) => ({
      url: `${SITE_URL}/a/${encodeURIComponent(key)}`,
      lastModified,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })
  );

  return [...staticPages, ...athletePages];
}
