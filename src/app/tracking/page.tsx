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
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-border bg-card p-3">
                <div className="mb-1.5 font-semibold text-foreground">ライブGPS追跡</div>
                <p>選手が装着したGPS端末から位置情報をリアルタイムで受信し、地図上に表示。観戦者はWebブラウザからライブで選手の動きを追えます</p>
                <div className="mt-2 rounded bg-amber-500/10 px-2 py-1 text-[10px] text-amber-400">
                  GPS端末の装着が必要
                </div>
              </div>
              <div className="rounded-lg border border-border bg-card p-3">
                <div className="mb-1.5 font-semibold text-foreground">レース後のリプレイ</div>
                <p>大会終了後も全選手のルートを再生し、ルートチョイスやスプリットタイムの比較分析が可能。スポーツウォッチやスマホで記録したGPXファイルをアップロードすれば、GPS端末なしでも他の選手のルートと比較できます</p>
                <div className="mt-2 rounded bg-green-500/10 px-2 py-1 text-[10px] text-green-400">
                  GPXアップロードならGPS端末不要
                </div>
              </div>
              <div className="rounded-lg border border-border bg-card p-3">
                <div className="mb-1.5 font-semibold text-foreground">スプリット分析</div>
                <p>コントロールごとのタイムを比較し、区間順位やレッグタイムの差を可視化します</p>
                <div className="mt-2 rounded bg-blue-500/10 px-2 py-1 text-[10px] text-blue-400">
                  ライブ・リプレイ共通
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Recommended devices */}
        <div className="rounded-lg border border-border bg-surface p-5">
          <h2 className="mb-3 text-sm font-bold">推奨GPS端末</h2>
          <div className="space-y-3 text-xs text-muted">
            <p>
              ライブGPS追跡には、セルラー通信（SIMカード）対応のGPSトラッカーが必要です。
              以下の端末で動作確認済みです
            </p>
            <div className="space-y-2">
              {/* Device 1 */}
              <div className="rounded-lg border border-border bg-card p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold text-foreground">Queclink GL300MA</div>
                    <div className="mt-0.5 text-[10px] text-primary">推奨 - プロ仕様</div>
                  </div>
                  <span className="flex-shrink-0 rounded bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">LTE Cat-M1</span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] sm:grid-cols-4">
                  <div><span className="text-muted">サイズ:</span> <span className="text-foreground">46×46×17mm</span></div>
                  <div><span className="text-muted">重量:</span> <span className="text-foreground">50g</span></div>
                  <div><span className="text-muted">バッテリー:</span> <span className="text-foreground">約12時間</span></div>
                  <div><span className="text-muted">送信間隔:</span> <span className="text-foreground">1〜60秒</span></div>
                </div>
                <p className="mt-2">高精度・高耐久のプロ向けトラッカー。IP67防水で雨天の大会でも安心。送信間隔を1秒に設定可能で、最も滑らかなライブ追跡が可能</p>
              </div>

              {/* Device 2 */}
              <div className="rounded-lg border border-border bg-card p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold text-foreground">Sinotrack ST-901L</div>
                    <div className="mt-0.5 text-[10px] text-green-400">低コスト</div>
                  </div>
                  <span className="flex-shrink-0 rounded bg-white/10 px-2 py-0.5 text-[10px] font-medium text-muted">4G LTE</span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] sm:grid-cols-4">
                  <div><span className="text-muted">サイズ:</span> <span className="text-foreground">50×36×16mm</span></div>
                  <div><span className="text-muted">重量:</span> <span className="text-foreground">35g</span></div>
                  <div><span className="text-muted">バッテリー:</span> <span className="text-foreground">約8時間</span></div>
                  <div><span className="text-muted">送信間隔:</span> <span className="text-foreground">5〜60秒</span></div>
                </div>
                <p className="mt-2">コストパフォーマンスに優れた小型トラッカー。多数台の導入に向いており、中規模以上の大会にも対応しやすい</p>
              </div>

              {/* Device 3 */}
              <div className="rounded-lg border border-border bg-card p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold text-foreground">スマートフォンアプリ</div>
                    <div className="mt-0.5 text-[10px] text-blue-400">端末購入不要</div>
                  </div>
                  <span className="flex-shrink-0 rounded bg-white/10 px-2 py-0.5 text-[10px] font-medium text-muted">Wi-Fi / 4G</span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] sm:grid-cols-4">
                  <div><span className="text-muted">サイズ:</span> <span className="text-foreground">各自のスマホ</span></div>
                  <div><span className="text-muted">重量:</span> <span className="text-foreground">-</span></div>
                  <div><span className="text-muted">バッテリー:</span> <span className="text-foreground">端末依存</span></div>
                  <div><span className="text-muted">送信間隔:</span> <span className="text-foreground">3〜60秒</span></div>
                </div>
                <p className="mt-2">trails.jp専用アプリ（開発中）をインストールし、選手自身のスマートフォンで位置を送信。端末の手配が不要で、練習会やカジュアルな大会に最適</p>
              </div>
            </div>

            <div className="rounded bg-white/5 px-3 py-2">
              <div className="mb-1 text-[11px] font-semibold text-foreground">SIMカードについて</div>
              <p>GPS端末にはデータ通信用のSIMカードが必要です。IIJmio、povo、SORACOM Air 等の低容量データSIMが適しています。1端末あたり月額200〜500円程度で運用可能です</p>
            </div>
          </div>
        </div>

        {/* Setup guide */}
        <div className="rounded-lg border border-border bg-surface p-5">
          <h2 className="mb-3 text-sm font-bold">ライブ追跡の設定方法</h2>
          <div className="space-y-3 text-xs text-muted">
            <p>大会主催者は以下の手順でライブGPS追跡を設定できます</p>

            <div className="space-y-2">
              <div className="flex gap-3 rounded-lg border border-border bg-card p-3">
                <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">1</div>
                <div>
                  <div className="font-semibold text-foreground">イベントを作成</div>
                  <p className="mt-0.5">大会名、日時、開催場所を入力。地図上でコース範囲を設定し、コントロール位置を登録します</p>
                </div>
              </div>

              <div className="flex gap-3 rounded-lg border border-border bg-card p-3">
                <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">2</div>
                <div>
                  <div className="font-semibold text-foreground">GPS端末を登録</div>
                  <p className="mt-0.5">使用するGPS端末のIMEI番号（端末固有のID）をイベントに登録。端末の送信先サーバーをtrails.jpに設定します</p>
                  <div className="mt-1.5 rounded bg-white/5 px-2 py-1 font-mono text-[10px] text-foreground">
                    送信先: tracking.trails.jp:5023 (TCP)
                  </div>
                </div>
              </div>

              <div className="flex gap-3 rounded-lg border border-border bg-card p-3">
                <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">3</div>
                <div>
                  <div className="font-semibold text-foreground">選手に端末を割り当て</div>
                  <p className="mt-0.5">各GPS端末を選手に紐付け。選手名、所属クラブ、クラスを入力します。スタートリストのCSVインポートにも対応</p>
                </div>
              </div>

              <div className="flex gap-3 rounded-lg border border-border bg-card p-3">
                <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">4</div>
                <div>
                  <div className="font-semibold text-foreground">ライブ配信を開始</div>
                  <p className="mt-0.5">大会当日、管理画面から配信を開始。GPS端末の電源を入れれば自動的に位置情報が地図に反映されます。配信URLを大会サイトやSNSで共有してください</p>
                </div>
              </div>
            </div>

            <div className="rounded bg-white/5 px-3 py-2">
              <div className="mb-1 text-[11px] font-semibold text-foreground">大会後の処理</div>
              <p>配信終了後、ルートデータは自動的にアーカイブされ、リプレイとして公開されます。GPXファイルのエクスポートも可能です</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
