import type { Metadata } from "next";
import MastersClient from "../../_components/MastersClient";

export const metadata: Metadata = {
  title: "マスタ設定 | trails.jp",
  robots: { index: false, follow: false },
};

export default async function CarpoolMastersPage({
  params,
  searchParams,
}: {
  params: Promise<{ club: string }>;
  searchParams: Promise<{ focus?: string }>;
}) {
  const { club } = await params;
  const { focus } = await searchParams;
  // P5.5: plan からの座標未取得ジャンプ（?focus=missing-coords）をクライアントへ渡す。
  // useSearchParams は Next 16 で Suspense 境界を要求しビルド時 CSR バブルを起こし得るため、
  // server component で受けて prop で渡す（静的生成に安全な経路）。
  return (
    <MastersClient
      slug={club}
      focus={focus === "missing-coords" ? "missing-coords" : undefined}
    />
  );
}
