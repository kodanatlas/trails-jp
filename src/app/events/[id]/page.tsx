import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { sampleJOEEvents } from "@/lib/sample-data-joe";

type Props = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const event = sampleJOEEvents.find((e) => e.joe_event_id === parseInt(id, 10));
  return { title: event?.name ?? "イベント" };
}

/**
 * JOE イベント詳細ページ
 * japan-o-entry.com の該当ページにリダイレクトする
 */
export default async function EventDetailPage({ params }: Props) {
  const { id } = await params;
  const eventId = parseInt(id, 10);
  const event = sampleJOEEvents.find((e) => e.joe_event_id === eventId);

  if (event) {
    redirect(event.joe_url);
  }

  // JOE の URL パターンにフォールバック
  redirect(`https://japan-o-entry.com/event/view/${id}`);
}
