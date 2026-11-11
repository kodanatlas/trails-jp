import type { Metadata } from "next";
import PlanClient from "../../../_components/PlanClient";

export const metadata: Metadata = {
  title: "配車プラン",
  robots: { index: false, follow: false },
};

export default async function CarpoolPlanPage({
  params,
}: {
  params: Promise<{ club: string; event: string }>;
}) {
  const { club, event } = await params;
  return <PlanClient slug={club} eventId={event} />;
}
