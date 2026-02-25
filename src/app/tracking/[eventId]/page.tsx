import { notFound } from "next/navigation";
import { sampleTrackingEvents } from "@/lib/tracking/sample-data";
import { TrackingView } from "./TrackingView";

interface Props {
  params: Promise<{ eventId: string }>;
}

export function generateStaticParams() {
  return sampleTrackingEvents.map((e) => ({ eventId: e.id }));
}

export async function generateMetadata({ params }: Props) {
  const { eventId } = await params;
  const event = sampleTrackingEvents.find((e) => e.id === eventId);
  return {
    title: event ? `${event.title} - GPS追跡` : "GPS追跡",
  };
}

export default async function TrackingEventPage({ params }: Props) {
  const { eventId } = await params;
  const event = sampleTrackingEvents.find((e) => e.id === eventId);
  if (!event) notFound();

  return <TrackingView event={event} />;
}
