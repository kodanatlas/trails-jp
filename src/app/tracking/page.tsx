import type { Metadata } from "next";
import Link from "next/link";
import { Radio, MapPin, Users, Calendar, ChevronRight } from "lucide-react";
import { sampleTrackingEvents } from "@/lib/tracking/sample-data";

export const metadata: Metadata = {
  title: "ライブGPS追跡",
  description: "オリエンテーリング大会のリアルタイムGPS追跡とルート分析。",
};

export default function TrackingListPage() {
  const events = sampleTrackingEvents;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-1 flex items-center gap-2">
        <h1 className="text-2xl font-bold">ライブGPS追跡</h1>
        <span className="rounded bg-green-500/15 px-2 py-0.5 text-[10px] font-medium text-green-400">
          Route Analysis
        </span>
      </div>
      <p className="mb-8 text-xs text-muted">
        大会中のリアルタイムGPS追跡とルート分析。GPXファイルのアップロードにも対応。
      </p>

      {/* Live Events */}
      {events.some((e) => e.status === "live") && (
        <div className="mb-8">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold">
            <Radio className="h-4 w-4 animate-pulse text-red-400" />
            ライブ配信中
          </h2>
          <div className="space-y-2">
            {events
              .filter((e) => e.status === "live")
              .map((event) => (
                <Link
                  key={event.id}
                  href={`/tracking/${event.id}`}
                  className="group flex items-center gap-4 rounded-lg border border-red-500/30 bg-card p-4 transition-all hover:border-red-500/50 hover:bg-card-hover"
                >
                  <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-red-500/15">
                    <Radio className="h-5 w-5 animate-pulse text-red-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-[9px] font-bold text-red-400">LIVE</span>
                      <h3 className="truncate text-sm font-bold group-hover:text-primary">{event.title}</h3>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" /> {event.date}
                      </span>
                      <span className="flex items-center gap-1">
                        <MapPin className="h-3 w-3" /> {event.location}
                      </span>
                      <span className="flex items-center gap-1">
                        <Users className="h-3 w-3" /> {event.participants.length}人
                      </span>
                    </div>
                  </div>
                  <ChevronRight className="h-5 w-5 flex-shrink-0 text-muted transition-transform group-hover:translate-x-1 group-hover:text-primary" />
                </Link>
              ))}
          </div>
        </div>
      )}

      {/* Archived Events */}
      <div>
        <h2 className="mb-3 text-sm font-bold text-muted">過去のイベント</h2>
        <div className="space-y-2">
          {events
            .filter((e) => e.status === "archived")
            .sort((a, b) => b.date.localeCompare(a.date))
            .map((event) => (
              <Link
                key={event.id}
                href={`/tracking/${event.id}`}
                className="group flex items-center gap-4 rounded-lg border border-border bg-card p-4 transition-all hover:border-primary/30 hover:bg-card-hover"
              >
                <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-surface text-lg font-bold text-primary">
                  <MapPin className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-bold group-hover:text-primary">{event.title}</h3>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted">
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" /> {event.date}
                    </span>
                    <span className="flex items-center gap-1">
                      <MapPin className="h-3 w-3" /> {event.location}
                    </span>
                    <span className="flex items-center gap-1">
                      <Users className="h-3 w-3" /> {event.participants.length}人
                    </span>
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 flex-shrink-0 text-muted transition-transform group-hover:translate-x-1 group-hover:text-primary" />
              </Link>
            ))}
        </div>
      </div>

      {/* Info */}
      <div className="mt-10 space-y-4">
        {/* How it works */}
        <div className="rounded-lg border border-border bg-surface p-5">
          <h2 className="mb-3 text-sm font-bold">GPS追跡について</h2>
          <div className="space-y-3 text-xs text-muted">
            <p>
              大会中のリアルタイムGPS追跡には、選手が<strong className="text-foreground">専用のGPS端末を装着</strong>する必要があります。
              GPS端末は大会当日に主催者から配布され、レース後に返却します。
              端末は軽量で競技に影響しない設計です。
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-border bg-card p-3">
                <div className="mb-1.5 font-semibold text-foreground">ライブGPS追跡</div>
                <p>選手が装着したGPS端末から位置情報をリアルタイムで受信し、地図上に表示します。観戦者はWebブラウザからライブで選手の動きを追えます。</p>
                <div className="mt-2 rounded bg-amber-500/10 px-2 py-1 text-[10px] text-amber-400">
                  GPS端末の装着が必要
                </div>
              </div>
              <div className="rounded-lg border border-border bg-card p-3">
                <div className="mb-1.5 font-semibold text-foreground">レース後のリプレイ</div>
                <p>大会終了後も全選手のルートを再生し、ルートチョイスやスプリットタイムの比較分析ができます。</p>
                <div className="mt-2 rounded bg-amber-500/10 px-2 py-1 text-[10px] text-amber-400">
                  GPS端末の装着が必要
                </div>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-border bg-card p-3">
                <div className="mb-1.5 font-semibold text-foreground">GPXアップロード</div>
                <p>スポーツウォッチやスマートフォンで記録したGPXファイルをアップロードして、他の選手のルートと比較できます。</p>
                <div className="mt-2 rounded bg-green-500/10 px-2 py-1 text-[10px] text-green-400">
                  GPS端末不要 - 自分のデバイスでOK
                </div>
              </div>
              <div className="rounded-lg border border-border bg-card p-3">
                <div className="mb-1.5 font-semibold text-foreground">スプリット分析</div>
                <p>コントロールごとのタイムを比較し、区間順位やレッグタイムの差を可視化します。</p>
                <div className="mt-2 rounded bg-blue-500/10 px-2 py-1 text-[10px] text-blue-400">
                  ライブ・リプレイ共通
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* For organizers */}
        <div className="rounded-lg border border-border bg-surface p-5">
          <h2 className="mb-2 text-sm font-bold">大会主催者の方へ</h2>
          <div className="space-y-1.5 text-xs text-muted">
            <p>
              GPS追跡サービスの導入をご検討の方は、お気軽にお問い合わせください。
            </p>
            <ul className="ml-4 list-disc space-y-1">
              <li>GPS端末の手配・配送・回収を含むフルサポート</li>
              <li>大会ページへのライブ追跡リンク埋め込み</li>
              <li>レース後のリプレイとルート分析の自動公開</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
