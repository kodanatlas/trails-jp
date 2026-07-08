import Link from "next/link";
import { TrendingUp, ArrowRight } from "lucide-react";
import moversJson from "@/data/movers.json";

/** movers.json のスキーマ（basis=wow なら先週比・mom なら前月比の順位上昇 top） */
interface MoverItem {
  name: string; // 表示用生名（スペース保持）
  key: string; // 空白除去名（/a/<key> リンク用）
  club: string;
  type: string;
  className: string;
  rank: number;
  delta: number; // 順位上昇（basis に応じ先週比 or 前月比）
  pointsDelta: number; // 得点変動
}

interface MoversData {
  generatedAtJst: string;
  basis?: "wow" | "mom";
  items: MoverItem[];
}

// 旧スキーマ（mom/pointsMom）が残っていても型エラーにならないようキャスト
const movers = moversJson as unknown as MoversData;

/** トップページ「急上昇」セクション（ビルド時静的データ・先週比 or 前月比） */
export function MonthlyMovers() {
  const items = (movers.items ?? []).slice(0, 5);

  // データが薄い週/月（月初など）はセクションごと出さない
  if (items.length < 3) return null;

  const isWow = movers.basis === "wow";
  const title = isWow ? "今週の急上昇" : "今月の急上昇";
  const badge = isWow ? "先週比" : "前月比";

  return (
    <section className="border-b border-border py-12 sm:py-16">
      <div className="mx-auto max-w-6xl px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-green-400" />
            <h2 className="text-lg font-bold">{title}</h2>
            <span className="rounded bg-green-500/15 px-1.5 py-0.5 text-[9px] font-medium text-green-400">
              {badge}
            </span>
          </div>
          <Link href="/analysis" className="text-xs font-medium text-primary hover:underline">
            選手分析へ →
          </Link>
        </div>

        <div className="mt-5 space-y-2">
          {items.map((item, i) => (
            <Link
              key={item.key}
              href={`/a/${encodeURIComponent(item.key)}`}
              className="flex items-center gap-3 rounded-lg border border-border bg-card p-4 transition-all hover:border-primary/30 hover:bg-card-hover sm:gap-4"
            >
              {/* 順位バッジ */}
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-surface text-xs font-bold text-muted">
                {i + 1}
              </div>

              {/* 選手情報 */}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold">{item.name}</h3>
                  <span className="rounded bg-white/5 px-2 py-0.5 text-[10px] text-muted">
                    {item.className}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-xs text-muted">{item.club}</p>
              </div>

              {/* 順位上昇 */}
              <div className="flex-shrink-0 text-right">
                <p className="font-mono text-sm font-bold text-green-400">
                  ↑{item.delta.toLocaleString()}
                </p>
                <p className="text-[10px] text-muted">現在 {item.rank.toLocaleString()}位</p>
              </div>

              {/* ポイント上昇 */}
              <div className="hidden w-24 flex-shrink-0 text-right sm:block">
                <p className="font-mono text-xs font-medium text-green-400">
                  {item.pointsDelta >= 0 ? "+" : ""}
                  {item.pointsDelta.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                </p>
                <p className="text-[10px] text-muted">pt {badge}</p>
              </div>

              <ArrowRight className="hidden h-4 w-4 flex-shrink-0 text-muted sm:block" />
            </Link>
          ))}
        </div>

        <p className="mt-3 text-right text-[10px] text-muted">
          {movers.generatedAtJst} 時点・JOYランキング{badge}
        </p>
      </div>
    </section>
  );
}
