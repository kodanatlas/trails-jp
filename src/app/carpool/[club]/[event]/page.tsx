import type { Metadata } from "next";
import ParticipationClient from "../../_components/ParticipationClient";

export const metadata: Metadata = {
  title: "配車イベント",
  robots: { index: false, follow: false },
};

export default async function CarpoolEventPage({
  params,
}: {
  params: Promise<{ club: string; event: string }>;
}) {
  const { club, event } = await params;
  return <ParticipationClient slug={club} eventId={event} />;
}
