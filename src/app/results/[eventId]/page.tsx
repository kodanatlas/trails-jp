import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { readEvents } from "@/lib/events-store";
import { fetchEventClasses } from "@/lib/scraper/lapcenter";

// fetchEventClasses が undici を使うため Node ランタイム必須・events 最新反映
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

type Props = { params: Promise<{ eventId: string }> };

async function resolveEventName(id: number): Promise<{ name: string; date: string } | null> {
  if (Number.isNaN(id)) return null;
  try {
    const events = await readEvents();
    const ev = events.find((x) => x.lapcenter_event_id === id);
    return ev ? { name: ev.name, date: ev.date } : null;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { eventId } = await params;
  const ev = await resolveEventName(Number(eventId));
  return { title: ev ? `${ev.name} クラス選択` : "クラス選択" };
}

export default async function EventClassPicker({ params }: Props) {
  const { eventId } = await params;
  const id = Number(eventId);
  if (Number.isNaN(id)) redirect("/results");

  const ev = await resolveEventName(id);
  let classes: { classId: number; className: string; distance: string }[] = [];
  try {
    classes = await fetchEventClasses(id);
  } catch {
    // LapCenter 応答なし → 空
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Link href="/results" className="text-xs text-muted transition-colors hover:text-foreground">
        ← 大会一覧
      </Link>
      <h1 className="mt-2 text-xl font-bold">{ev?.name ?? `イベント ${id}`}</h1>
      <p className="mb-5 text-xs text-muted">{[ev?.date, "クラスを選択"].filter(Boolean).join(" ・ ")}</p>

      {classes.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted">
          クラスを取得できませんでした（LapCenter が応答しないか、対象外の大会の可能性）。
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {classes.map((c) => (
            <Link
              key={c.classId}
              href={`/results/${id}/${c.classId}`}
              className="flex items-center justify-between rounded-lg border border-border bg-card p-3 transition-colors hover:border-primary/30 hover:bg-card-hover"
            >
              <span className="font-bold">{c.className}</span>
              <span className="flex items-center gap-1 text-xs text-muted">
                {c.distance}
                <ChevronRight className="h-4 w-4" />
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
