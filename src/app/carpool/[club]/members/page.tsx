import type { Metadata } from "next";
import MembersClient from "../../_components/MembersClient";

export const metadata: Metadata = {
  title: "メンバー管理 | trails.jp",
  robots: { index: false, follow: false },
};

export default async function CarpoolMembersPage({
  params,
}: {
  params: Promise<{ club: string }>;
}) {
  const { club } = await params;
  return <MembersClient slug={club} />;
}
