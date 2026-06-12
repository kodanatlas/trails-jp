import type { Metadata } from "next";
import MastersClient from "../../_components/MastersClient";

export const metadata: Metadata = {
  title: "マスタ設定 | trails.jp",
  robots: { index: false, follow: false },
};

export default async function CarpoolMastersPage({
  params,
}: {
  params: Promise<{ club: string }>;
}) {
  const { club } = await params;
  return <MastersClient slug={club} />;
}
