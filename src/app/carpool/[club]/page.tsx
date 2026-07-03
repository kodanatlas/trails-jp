import type { Metadata } from "next";
import CarpoolHomeClient from "../_components/CarpoolHomeClient";

export const metadata: Metadata = {
  title: "配車ホーム",
  robots: { index: false, follow: false },
};

export default async function CarpoolClubHomePage({
  params,
}: {
  params: Promise<{ club: string }>;
}) {
  const { club } = await params;
  return <CarpoolHomeClient slug={club} />;
}
