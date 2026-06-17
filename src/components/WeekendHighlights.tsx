import Link from "next/link";
import { TrendingUp, Gauge, Target, ArrowRight } from "lucide-react";
import wpJson from "@/data/weekend-points.json";
import { supabaseAdmin } from "@/lib/supabase-admin";
import athleteIndex from "../../public/data/athlete-index.json";
import {
  recentWeekendCandidates,
  jstToday,
  jstNowLabel,
  formatDateRangeJp,
} from "@/lib/weekend-window";

/** weekend-points.json（上「ポイント上昇度」）のスキーマ。 */
interface WeekendPointItem {
  name: string;
  key: string;
  club: string;
  discipline: "forest" | "sprint";
  eventName: string;
  pRecent: number;
  pAvg: number;
  delta: number;
}
interface WeekendPointsData {
  generatedAtJst: string;
  targetDates: string[];
  items: WeekendPointItem[];
}

/** weekend_standouts RPC（下「合成上昇度」）の返却行。 */
interface StandoutRow {
  athlete_name: string;
  race_type: "forest" | "sprint";
  event_name: string; // 選択された大会名（合成最大の大会）
  target_speed: number;
  baseline_speed: number;
  target_miss: number;
  baseline_miss: number;
  baseline_n: number;
  speed_gain_pct: number; // (baseline-target)/baseline*100 ＝ ＋なら自己平均より速い（巡航値が小さい）
  miss_drop_pp: number;
  composite: number;
  class_name: string;
  cluster_dates: string[];
}

const wp = wpJson as WeekendPointsData;

const num = (n: number, digits = 1) =>
  n.toLocaleString(undefined, { maximumFractionDigits: digits });

const disciplineLabel = (d: "forest" | "sprint") =>
  d === "forest" ? "フォレスト" : "スプリント";

/**
 * ミス率改善の表示テキストと色を値から導出する。
 * miss_drop_pp は ＋＝ミス減（改善）／−＝悪化。採用ゲートは速度のみ(今回<平均=速い)なので
 * ミス悪化行も出得る → 固定符号ではなく値から符号・色を決める。単位は「%pt」。
 */
function missDisplay(pp: number): { text: string; cls: string } {
  if (pp > 0) return { text: `ミス −${num(pp)}%pt`, cls: "text-green-400" };
  if (pp < 0) return { text: `ミス +${num(Math.abs(pp))}%pt`, cls: "text-red-400" };
  return { text: "ミス ±0%pt", cls: "text-muted" };
}

/** athlete-index.json から先頭クラブを引く（key = 空白除去名）。 */
function clubFor(key: string): string {
  const a = (athleteIndex as { athletes: Record<string, { clubs?: string[] }> })
    .athletes[key];
  return a?.clubs?.[0] ?? "";
}

/** 順位バッジ（movers と同一スタイル） */
function RankBadge({ n }: { n: number }) {
  return (
    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-surface text-xs font-bold text-muted">
      {n}
    </div>
  );
}

/** 上「ポイント上昇度」の1行。rank は連番（先頭5＋アコーディオンで継続）。 */
function PointRow({ item, rank }: { item: WeekendPointItem; rank: number }) {
  return (
    <Link
      href={`/analysis?athlete=${encodeURIComponent(item.key)}`}
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-card p-4 transition-all hover:border-primary/30 hover:bg-card-hover"
    >
      <RankBadge n={rank} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="text-sm font-semibold">{item.name}</h4>
          <span className="rounded bg-white/5 px-2 py-0.5 text-[10px] text-muted">
            {disciplineLabel(item.discipline)}
          </span>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted">{item.club}</p>
        {item.eventName && (
          <p className="mt-0.5 truncate text-[10px] text-muted">{item.eventName}</p>
        )}
      </div>
      {/* 指標: モバイルは名前の下に全幅で回り込み、sm以上は右寄せ（崩れ防止） */}
      <div className="flex w-full flex-col items-start gap-0.5 sm:w-auto sm:items-end">
        <p className="font-mono text-sm font-bold text-green-400">+{num(item.delta)} pt</p>
        {/* 内訳はモバイルでも表示（ユーザー必須要望） */}
        <p className="text-[10px] text-muted sm:text-right">
          今回 {num(item.pRecent)}・平均 {num(item.pAvg)}
        </p>
      </div>
      <ArrowRight className="hidden h-4 w-4 flex-shrink-0 text-muted sm:block" />
    </Link>
  );
}

/** 下「合成上昇度」の1行。rank は連番（先頭5＋アコーディオンで継続）。 */
function StandoutRowItem({ row, rank }: { row: StandoutRow; rank: number }) {
  const key = row.athlete_name;
  const miss = missDisplay(row.miss_drop_pp);
  return (
    <Link
      href={`/analysis?athlete=${encodeURIComponent(key)}`}
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-card p-4 transition-all hover:border-primary/30 hover:bg-card-hover"
    >
      <RankBadge n={rank} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="text-sm font-semibold">{key}</h4>
          <span className="rounded bg-white/5 px-2 py-0.5 text-[10px] text-muted">
            {row.class_name}・{disciplineLabel(row.race_type)}
          </span>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted">{clubFor(key)}</p>
        {row.event_name && (
          <p className="mt-0.5 truncate text-[10px] text-muted">{row.event_name}</p>
        )}
      </div>
      {/* 指標: モバイルは名前の下に全幅で回り込み、sm以上は右寄せ（崩れ防止） */}
      <div className="flex w-full flex-col items-start gap-0.5 sm:w-auto sm:items-end">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 sm:justify-end">
          <span className="inline-flex items-center gap-1 font-mono text-xs font-bold text-green-400">
            <Gauge className="h-3 w-3" />巡航 +{num(row.speed_gain_pct)}% 速
          </span>
          <span className={`inline-flex items-center gap-1 font-mono text-xs font-bold ${miss.cls}`}>
            <Target className="h-3 w-3" />{miss.text}
          </span>
        </div>
        {/* 内訳はモバイルでも表示（ユーザー必須要望） */}
        <p className="text-[10px] text-muted sm:text-right">
          巡航 今回 {num(row.target_speed)}/平均 {num(row.baseline_speed)}
          {" ・ "}ミス {num(row.target_miss)}/平均 {num(row.baseline_miss)}
        </p>
      </div>
      <ArrowRight className="hidden h-4 w-4 flex-shrink-0 text-muted sm:block" />
    </Link>
  );
}

/**
 * トップページ「直近の大会ハイライト」セクション。
 * 上 = ポイント上昇度（ビルド時静的・週次）／下 = 合成上昇度（ランタイム RPC・日次）。
 */
/** 先頭 N 件を常時表示・残りをアコーディオンに分割する上限と境界。 */
const VISIBLE = 5; // 常時表示件数
const MAX_ITEMS = 20; // 展開後の最大件数

export async function WeekendHighlights() {
  // 上: 静的 JSON（最大 20 件扱い）
  const pointItems = (wp.items ?? []).slice(0, MAX_ITEMS);
  const showPoints = pointItems.length >= 3;

  // 下: ランタイム RPC（service_role 専用 → supabaseAdmin）
  let standouts: StandoutRow[] = [];
  try {
    const candidates = recentWeekendCandidates(jstToday(), 35);
    const { data, error } = await supabaseAdmin.rpc("weekend_standouts", {
      candidate_dates: candidates,
      min_samples: 5,
      max_results: MAX_ITEMS,
    });
    // 無言全滅検知: error が返ったら必ずログを残してから空フォールバック
    if (error) console.warn("weekend_standouts rpc:", error);
    standouts = (data as StandoutRow[] | null) ?? [];
  } catch (e) {
    console.warn("weekend_standouts rpc threw:", e);
    standouts = [];
  }
  const showComposite = standouts.length >= 3;

  // 上下とも出せないならセクションごと非表示
  if (!showPoints && !showComposite) return null;

  // 下リストの対象日（行データの cluster_dates から）
  const compositeDates = standouts[0]?.cluster_dates ?? [];

  return (
    <section id="weekend-highlights" className="scroll-mt-20 border-b border-border py-12 sm:py-16">
      <div className="mx-auto max-w-6xl px-4">
        {/* セクション見出し */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-green-400" />
            <h2 className="text-lg font-bold">直近の大会ハイライト</h2>
          </div>
          <Link href="/analysis" className="text-xs font-medium text-primary hover:underline">
            選手分析へ →
          </Link>
        </div>

        {/* 対象の明示 + 更新タイミング注記（表示中のリストに応じて動的に） */}
        <p className="mt-2 text-xs text-muted">
          直近の土日祝の大会の出場者が対象です。
        </p>
        <p className="mt-1 text-xs text-muted">
          {showPoints && showComposite ? "※更新タイミングが異なります（" : "※更新タイミング: "}
          {[
            showPoints ? "ポイント=毎週水曜ごろ更新" : null,
            showComposite ? "巡航・ミス=毎日更新" : null,
          ]
            .filter(Boolean)
            .join(" ／ ")}
          {showPoints && showComposite ? "）" : ""}
        </p>

        {/* ===== 上: ポイント上昇度 ===== */}
        {showPoints && (
          <div className="mt-6">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold">ポイント上昇度</h3>
              <span className="rounded bg-green-500/15 px-1.5 py-0.5 text-[9px] font-medium text-green-400">
                ポイント・自己平均比
              </span>
            </div>
            <p className="mt-1 text-xs text-muted">
              直近の土日祝大会で獲得した JOY イベントポイントが、その選手の同種目・自己平均をどれだけ上回ったか。
            </p>

            <div className="mt-4 space-y-2">
              {pointItems.slice(0, VISIBLE).map((item, i) => (
                <PointRow key={item.key} item={item} rank={i + 1} />
              ))}
            </div>
            {/* 6件目以降をアコーディオンで展開（CSS details・サーバーコンポーネント維持） */}
            {pointItems.length > VISIBLE && (
              <details className="group mt-2">
                <summary className="cursor-pointer select-none list-none rounded-lg border border-border bg-card px-4 py-2.5 text-center text-xs font-medium text-primary transition-colors hover:bg-card-hover">
                  さらに表示（あと {pointItems.length - VISIBLE} 名）
                </summary>
                <div className="mt-2 space-y-2">
                  {pointItems.slice(VISIBLE).map((item, i) => (
                    <PointRow key={item.key} item={item} rank={VISIBLE + i + 1} />
                  ))}
                </div>
              </details>
            )}

            <p className="mt-3 text-right text-[10px] text-muted">
              対象 {formatDateRangeJp(wp.targetDates)}・{wp.generatedAtJst}（毎週水曜ごろ更新）
            </p>
          </div>
        )}

        {/* ===== 下: 合成上昇度 ===== */}
        {showComposite && (
          <div className="mt-8">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold">合成上昇度</h3>
              <span className="rounded bg-green-500/15 px-1.5 py-0.5 text-[9px] font-medium text-green-400">
                巡航/ミス・自己平均比
              </span>
            </div>

            {/* 算出方法の明示（常時表示の短文 + details で詳細式・平易語） */}
            <p className="mt-1 text-xs text-muted">
              巡航速度の改善度とミス率の改善度を、同じ週末に出場した選手どうしで比べて
              <strong className="font-semibold text-foreground">スコア化（両方良いほど高い）</strong>。
              巡航は速いほど＋、ミスは少ないほど＋。
            </p>
            <details className="mt-1 text-xs text-muted">
              <summary className="cursor-pointer select-none text-primary hover:underline">
                算出方法
              </summary>
              <p className="mt-1 leading-relaxed">
                合成スコア＝〈巡航速度が自己平均より何%速いか〉と〈ミス率が自己平均より何%ポイント少ないか〉を、
                同じ週末の出場者の中で“偏差値のように”標準化（平均0・ばらつき1に揃える）して合算。
                対象は同種目で過去5戦以上の実績があり、今回の巡航速度が自己平均より速かった選手。
              </p>
            </details>

            <div className="mt-4 space-y-2">
              {standouts.slice(0, VISIBLE).map((row, i) => (
                <StandoutRowItem key={`${row.athlete_name}-${row.race_type}`} row={row} rank={i + 1} />
              ))}
            </div>
            {/* 6件目以降をアコーディオンで展開（CSS details・サーバーコンポーネント維持） */}
            {standouts.length > VISIBLE && (
              <details className="group mt-2">
                <summary className="cursor-pointer select-none list-none rounded-lg border border-border bg-card px-4 py-2.5 text-center text-xs font-medium text-primary transition-colors hover:bg-card-hover">
                  さらに表示（あと {standouts.length - VISIBLE} 名）
                </summary>
                <div className="mt-2 space-y-2">
                  {standouts.slice(VISIBLE).map((row, i) => (
                    <StandoutRowItem
                      key={`${row.athlete_name}-${row.race_type}`}
                      row={row}
                      rank={VISIBLE + i + 1}
                    />
                  ))}
                </div>
              </details>
            )}

            <p className="mt-3 text-right text-[10px] text-muted">
              対象 {formatDateRangeJp(compositeDates)}・{jstNowLabel()} JST 時点（毎日更新）
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
