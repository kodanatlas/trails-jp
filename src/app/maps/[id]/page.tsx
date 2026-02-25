import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, MapPin, Ruler, Mountain, Calendar, Users, ExternalLink } from "lucide-react";
import { sampleMaps } from "@/lib/sample-data";
import { TERRAIN_LABELS } from "@/lib/utils";
import { findEventsForMap } from "@/lib/map-event-matcher";
import type { JOEEvent } from "@/lib/scraper/events";
import eventsJson from "@/data/events.json";
import { MapViewer } from "./MapViewer";
import { EditButton } from "./MapDetailClient";

type Props = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const map = sampleMaps.find((m) => m.id === id);
  return { title: map?.name ?? "地図が見つかりません" };
}

export default async function MapDetailPage({ params }: Props) {
  const { id } = await params;
  const map = sampleMaps.find((m) => m.id === id);

  if (!map) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-20 text-center">
        <h1 className="text-xl font-bold">地図が見つかりません</h1>
        <Link href="/maps" className="mt-4 inline-block text-sm text-primary hover:underline">
          地図一覧に戻る
        </Link>
      </div>
    );
  }

  const matchedEvents = findEventsForMap(map, eventsJson as JOEEvent[]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <Link href="/maps" className="mb-5 inline-flex items-center gap-1 text-xs text-muted hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" />
        地図データベース
      </Link>

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{map.name}</h1>
        <EditButton map={map} />
      </div>
      {map.description && <p className="mt-1.5 text-sm text-muted">{map.description}</p>}

      {/* Map Viewer */}
      <div className="mt-5 overflow-hidden rounded-lg border border-border">
        <MapViewer map={map} />
      </div>

      {/* Metadata Grid */}
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[
          { icon: MapPin, label: "場所", value: `${map.prefecture} ${map.city}` },
          { icon: Mountain, label: "テレイン", value: TERRAIN_LABELS[map.terrain_type] },
          { icon: Ruler, label: "縮尺 / 等高線", value: `${map.scale} / ${map.contour_interval}m` },
          { icon: Calendar, label: "作成年", value: `${map.created_year}年${map.updated_year ? ` (更新: ${map.updated_year}年)` : ""}` },
          { icon: Users, label: "作成者", value: map.creator },
        ].map((item) => (
          <div key={item.label} className="flex items-start gap-3 rounded-lg border border-border bg-card p-3">
            <item.icon className="mt-0.5 h-4 w-4 text-primary" />
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted">{item.label}</p>
              <p className="text-sm">{item.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Tags */}
      {map.tags.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {map.tags.map((tag) => (
            <span key={tag} className="rounded bg-primary/15 px-2.5 py-0.5 text-xs font-medium text-primary">
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Related JOY Events */}
      {matchedEvents.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 text-sm font-bold">このテレインで開催された大会</h2>
          <div className="space-y-1.5">
            {matchedEvents.map((event) => {
              const dt = new Date(event.date);
              const dateStr = `${dt.getFullYear()}/${dt.getMonth() + 1}/${dt.getDate()}`;
              return (
                <a
                  key={event.joe_event_id}
                  href={event.joe_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 transition-all hover:border-primary/30 hover:bg-card-hover"
                >
                  <span className="flex-shrink-0 text-xs font-medium text-primary">
                    {dateStr}
                  </span>
                  <span className="flex-1 truncate text-sm">{event.name}</span>
                  <ExternalLink className="h-3.5 w-3.5 flex-shrink-0 text-muted" />
                </a>
              );
            })}
          </div>
          <p className="mt-2 text-[10px] text-muted">
            JOY掲載の大会座標がこのテレイン範囲内に含まれるイベントを自動表示
          </p>
        </div>
      )}
    </div>
  );
}
