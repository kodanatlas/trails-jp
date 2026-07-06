import Link from "next/link";
import { TrendingUp, ArrowRight } from "lucide-react";
import moversJson from "@/data/movers.json";

/** movers.json のスキーマ（docs/plans/brushup_batch1_20260610.md §2-S2-2 で固定） */
interface MoverItem {
  name: string; // 表示用生名（スペース保持）
  key: string; // 空白除去名（/a/<key> リンク用）
  club: string;
  type: string;
  className: string;
  rank: number;
  mom: number;
  pointsMom: number;
}

interface MoversData {
  generatedAtJst: string;
  items: MoverItem[];
}

// Agent A 再生成前の旧スキーマでも型エラーにならないようキャスト（スキーマは契約で固定済み）
const movers = moversJson as unknown as MoversData;

/** トップページ「今月の急上昇」セクション（ビルド時静的データ） */
export function MonthlyMovers() {
  const items = (movers.items ?? []).slice(0, 5);

  // データが薄い月（月初など）はセクションごと出さない
  if (items.length < 3) return null;

  return (
    <section className="border-b border-border py-12 sm:py-16">
      <div className="mx-auto max-w-6xl px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-green-400" />
            <h2 className="text-lg font-bold">今月の急上昇</h2>
            <span className="rounded bg-green-500/15 px-1.5 py-0.5 text-[9px] font-medium text-green-400">
              前月比
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
                  ↑{item.mom.toLocaleString()}
                </p>
                <p className="text-[10px] text-muted">現在 {item.rank.toLocaleString()}位</p>
              </div>

              {/* ポイント上昇 */}
              <div className="hidden w-24 flex-shrink-0 text-right sm:block">
                <p className="font-mono text-xs font-medium text-green-400">
                  +{item.pointsMom.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                </p>
                <p className="text-[10px] text-muted">pt 前月比</p>
              </div>

              <ArrowRight className="hidden h-4 w-4 flex-shrink-0 text-muted sm:block" />
            </Link>
          ))}
        </div>

        <p className="mt-3 text-right text-[10px] text-muted">
          {movers.generatedAtJst} 時点・JOYランキング前月比
        </p>
      </div>
    </section>
  );
}
