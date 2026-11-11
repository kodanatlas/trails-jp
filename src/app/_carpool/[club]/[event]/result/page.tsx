import type { Metadata } from "next";
import ResultClient from "../../../_components/ResultClient";

export const metadata: Metadata = {
  title: "配車結果",
  robots: { index: false, follow: false },
};

export default async function CarpoolResultPage({
  params,
}: {
  params: Promise<{ club: string; event: string }>;
}) {
  const { club, event } = await params;
  return <ResultClient slug={club} eventId={event} />;
}
