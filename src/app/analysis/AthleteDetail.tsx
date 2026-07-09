"use client";

import { useState, useEffect, useMemo, useRef, type ReactNode } from "react";
import Link from "next/link";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import { Loader2, TrendingUp, TrendingDown, Minus, Target, Zap, Calendar, ChevronDown, Share2, Link as LinkIcon, Check } from "lucide-react";
import type { AthleteSummary, AthleteProfile, AthleteIndex, LapCenterPerformance } from "@/lib/analysis/types";
import type { AthleteEntryRef } from "@/lib/entries/index-types";
import {
  loadAthleteDetail,
  calcConsistency,
  calcRecentForm,
  getAllEvents,
  typeLabel,
  getBestRanks,
} from "@/lib/analysis/utils";
import { eventFuzzyMatch, matchLcRace } from "@/lib/analysis/event-match";
import { theilSenTrend } from "@/lib/analysis/cross-race";
import { SITE_URL } from "@/lib/site";
import { UpcomingEntries } from "./UpcomingEntries";
import { HeadToHead } from "./HeadToHead";
import { CrossRaceCard } from "./CrossRaceCard";
import { LegFingerprintCard, loadLegFingerprint } from "./LegFingerprintCard";

interface Props {
  summary: AthleteSummary;
  athleteIndex: AthleteIndex;
}

/**
 * 子（recharts チャート等の重量コンポーネント）を viewport 近接までマウント遅延する。
 * iOS Safari の WebContent メモリ上限対策: 選手ページで複数チャートが一斉マウントすると
 * ピークメモリが端末上限を超え、間欠的にタブがクラッシュ（"問題が繰り返し起きました"）する。
 * 同時マウント数を抑えて緩和する。表示前はプレースホルダで領域を確保し CLS を出さない。
 */
function DeferUntilVisible({
  minHeight,
  children,
}: {
  minHeight: number;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // 非対応環境（IntersectionObserver なし）は遅延せず即マウント
    if (typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: "300px" }, // 画面到達の少し手前で先読みマウント
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} style={shown ? undefined : { minHeight }}>
      {shown ? children : null}
    </div>
  );
}

export function AthleteDetail({ summary, athleteIndex }: Props) {
  const [profile, setProfile] = useState<AthleteProfile | null>(null);
  const [lcData, setLcData] = useState<LapCenterPerformance[] | null>(null);
  const [entryData, setEntryData] = useState<
    { entries: AthleteEntryRef[]; generatedAt: string | null } | null
  >(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 選手切替時の stale レスポンス混入を防ぐガード（前選手の応答が後勝ちで上書きするのを防止）
    let cancelled = false;
    setLoading(true);
    setLcData(null);
    setEntryData(null);

    // DB 由来 API（/api/lc・/api/athletes）は Supabase 障害時にハングしうる。
    // アボート付き fetch でページ全体を固めない（12秒で諦めて null 扱い）。
    const fetchJson = async (url: string): Promise<Record<string, unknown> | unknown[] | null> => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12000);
      try {
        const r = await fetch(url, { signal: ctrl.signal });
        return r.ok ? await r.json() : null;
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    };

    // 必須データ＝プロフィール（静的ランキング JSON 由来）。これが決まった時点でページを描画する。
    // 取得不能でも summary から最小プロフィールにフォールバックし、ヘッダ/特性/安定性は出す。
    const fallbackProfile: AthleteProfile = { ...summary, rankings: [] };
    Promise.race([
      loadAthleteDetail(summary),
      new Promise<AthleteProfile>((res) => setTimeout(() => res(fallbackProfile), 12000)),
    ])
      .then((p) => {
        if (!cancelled) setProfile(p);
      })
      .catch(() => {
        if (!cancelled) setProfile(fallbackProfile);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    // 非必須（LapCenter 履歴・エントリー）は独立ロード。ハング/失敗してもページは出る。
    fetchJson(`/api/lc/${encodeURIComponent(summary.name)}`).then((records) => {
      if (!cancelled) setLcData(Array.isArray(records) ? (records as LapCenterPerformance[]) : null);
    });
    fetchJson(`/api/athletes/${encodeURIComponent(summary.name)}/entries`).then((d) => {
      if (!cancelled) {
        const obj = (d ?? {}) as { entries?: AthleteEntryRef[]; generatedAt?: string | null };
        setEntryData({ entries: obj.entries ?? [], generatedAt: obj.generatedAt ?? null });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [summary]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        <span className="ml-2 text-sm text-muted">詳細データを読み込み中...</span>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted">
        この選手の詳細を読み込めませんでした。時間をおいて再度お試しください。
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <ProfileHeader profile={profile} />
      <TypeBadge profile={profile} />
      <RecentMovement profile={profile} />
      <StatsCards profile={profile} />
      <DeferUntilVisible minHeight={320}>
        <ScoreChart profile={profile} />
      </DeferUntilVisible>
      {lcData && lcData.length >= 2 && (
        <DeferUntilVisible minHeight={560}>
          <LapCenterChart data={lcData} profile={profile} />
        </DeferUntilVisible>
      )}
      <CrossRaceCard name={profile.name} />
      <DeferUntilVisible minHeight={280}>
        <LegFingerprintCard name={profile.name} />
      </DeferUntilVisible>
      <RecentEvents profile={profile} lcData={lcData} />
      {/* key で選手切替時に相手選択をリセット */}
      <HeadToHead
        key={profile.name}
        profile={profile}
        athleteIndex={athleteIndex}
        myEntries={entryData?.entries ?? null}
      />
      <UpcomingEntries data={entryData} />
    </div>
  );
}

/**
 * 最近の動き: この選手の主戦クラス（rankDelta を持つ appearance のうち最上位）の
 * 前月比の順位・得点変動を1行で見せる（JOYランキングの月次スナップショット由来）。
 * 前月スナップショットが無い選手（新規・久々の復帰）は非表示。
 */
function RecentMovement({ profile }: { profile: AthleteProfile }) {
  // 先週比(wow)が有れば優先、無ければ前月比(mom)
  const rankVal = (r: AthleteProfile["rankings"][number]) => r.rankDelta?.wow ?? r.rankDelta?.mom ?? null;
  const withDelta = profile.rankings.filter((r) => rankVal(r) != null);
  if (withDelta.length === 0) return null;
  // 主戦＝デルタを持つ中で最上位（rank 最小）
  const primary = withDelta.reduce((best, r) => (r.rank < best.rank ? r : best));
  const isWow = primary.rankDelta?.wow != null;
  const label = isWow ? "先週比" : "前月比";
  const rankDelta = rankVal(primary)!;
  const ptsDelta = isWow ? primary.pointsDelta?.wow ?? null : primary.pointsDelta?.mom ?? null;
  const isSprint = primary.type.includes("sprint");
  const up = rankDelta > 0;
  const flat = rankDelta === 0;
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">最近の動き</span>
        <span className="text-[10px] text-muted">
          {isSprint ? "スプリント" : "フォレスト"} {primary.className}
        </span>
        <span className="text-sm">
          <span className="font-bold">{primary.rank.toLocaleString()}位</span>
          <span className={`ml-1.5 font-mono text-xs font-bold ${flat ? "text-muted" : up ? "text-green-400" : "text-accent"}`}>
            {flat ? "±0" : `${up ? "↑" : "↓"}${Math.abs(rankDelta).toLocaleString()}`}
          </span>
          <span className="ml-0.5 text-[10px] text-muted">{label}</span>
        </span>
        {ptsDelta != null && ptsDelta !== 0 && (
          <span className="text-xs text-muted">
            得点{" "}
            <span className={`font-mono font-bold ${ptsDelta > 0 ? "text-green-400" : "text-accent"}`}>
              {ptsDelta > 0 ? "+" : ""}
              {ptsDelta.toLocaleString(undefined, { maximumFractionDigits: 1 })}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}

/** ヘッダー: 名前・クラブ・カテゴリ数 */
function ProfileHeader({ profile }: { profile: AthleteProfile }) {
  const [showBreakdown, setShowBreakdown] = useState(false);

  // 無差別クラスのランキングを特定（ビルドスクリプトと同一ロジック）
  const isFemale = profile.appearances.some(
    (r) => r.className === "女子無差別" || r.className === "S_女子無差別"
  );
  const openForestClass = isFemale ? "女子無差別" : "無差別";
  const openSprintClass = isFemale ? "S_女子無差別" : "S_無差別";

  const forestRanking = profile.rankings.find(
    (r) => r.type === "age_forest" && r.className === openForestClass
  );
  const sprintRanking = profile.rankings.find(
    (r) => r.type === "age_sprint" && r.className === openSprintClass
  );

  const forestPts = forestRanking?.totalPoints;
  const sprintPts = sprintRanking?.totalPoints;
  const hasBoth = forestPts != null && sprintPts != null;

  // 補正済みポイント（旧インデックスには無いので従来値にフォールバック）
  const adjPoints = profile.adjustedPoints ?? profile.avgTotalPoints;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">{profile.name}</h2>
          <p className="text-xs text-muted">{profile.clubs.join(" / ")}</p>
        </div>
        <div className="flex items-start gap-3">
          <ShareButtons name={profile.name} />
          <div className="text-right">
            <p className="text-2xl font-bold text-primary">
              {adjPoints.toLocaleString(undefined, { maximumFractionDigits: 1 })}
            </p>
            <button
              onClick={() => setShowBreakdown((v) => !v)}
              className="inline-flex items-center gap-0.5 text-[10px] text-muted hover:text-foreground transition-colors"
            >
              補正済みポイント
              <ChevronDown className={`h-3 w-3 transition-transform ${showBreakdown ? "rotate-180" : ""}`} />
            </button>
            {(forestRanking || sprintRanking) && (
              <p className="text-[10px] text-muted">
                {forestRanking && (
                  <span className="text-green-400 whitespace-nowrap">
                    F {forestRanking.totalPoints.toLocaleString()}（{forestRanking.rank}位）
                  </span>
                )}
                {forestRanking && sprintRanking && <span className="text-muted/50"> / </span>}
                {sprintRanking && (
                  <span className="text-blue-400 whitespace-nowrap">
                    S {sprintRanking.totalPoints.toLocaleString()}（{sprintRanking.rank}位）
                  </span>
                )}
              </p>
            )}
            <p className="text-[9px] text-muted/60">
              種目間の水準差を補正（
              <a href="/docs/analysis-system#adjusted" className="underline hover:text-foreground">
                算出方法
              </a>
              ）
            </p>
          </div>
        </div>
      </div>

      {showBreakdown && (
        <div className="mt-3 border-t border-border pt-3 space-y-3">
          {/* 計算式 */}
          <div className="rounded bg-surface p-2.5 text-xs text-muted">
            <p className="mb-1 text-[9px] text-muted/60">
              各大会の得点をフォレスト基準に補正（スプリントの大会は水準差 約0.4σ/3 を差し引く）し、フォレスト／スプリント混在で上位3大会を合計。下段は無補正の無差別総合（参考）。
            </p>
            <div className="font-mono">
              {hasBoth ? (
                <>
                  <span className="text-green-400">{forestPts!.toLocaleString()}</span>
                  <span className="text-muted/60 text-[9px]"> {openForestClass}</span>
                  <span className="mx-1">／</span>
                  <span className="text-blue-400">{sprintPts!.toLocaleString()}</span>
                  <span className="text-muted/60 text-[9px]"> {openSprintClass}</span>
                  <span className="mx-1">→ 補正後 上位3大会合計</span>
                  <span className="font-bold text-primary">
                    {adjPoints.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                  </span>
                </>
              ) : forestPts != null ? (
                <>
                  Forest {openForestClass}のみ:{" "}
                  <span className="font-bold text-primary">{forestPts.toLocaleString()}</span>
                </>
              ) : sprintPts != null ? (
                <>
                  Sprint {openSprintClass}のみ:{" "}
                  <span className="font-bold text-primary">{sprintPts.toLocaleString()}</span>
                </>
              ) : (
                <>全カテゴリ最大値: <span className="font-bold text-primary">{profile.avgTotalPoints.toLocaleString()}</span></>
              )}
            </div>
          </div>

          {/* Forest 内訳 */}
          {forestRanking && (
            <PointBreakdownTable
              label={`Forest ${openForestClass}`}
              color="green"
              ranking={forestRanking}
            />
          )}

          {/* Sprint 内訳 */}
          {sprintRanking && (
            <PointBreakdownTable
              label={`Sprint ${openSprintClass}`}
              color="blue"
              ranking={sprintRanking}
            />
          )}

          {!forestRanking && !sprintRanking && (
            <p className="text-[10px] text-muted">無差別クラスのランキングデータがありません</p>
          )}
        </div>
      )}
    </div>
  );
}

/** シェアボタン群: X intent・Web Share・URL コピー（シェア URL は /a/[name] カードページ） */
function ShareButtons({ name }: { name: string }) {
  const [copied, setCopied] = useState(false);

  // name は athlete-index のキー（空白除去名）。シェア URL は必ず encodeURIComponent で組み立てる
  const shareUrl = `${SITE_URL}/a/${encodeURIComponent(name)}`;
  const shareText = `${name}のオリエンタイプ #trails_jp`;
  const intentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`;

  const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  const handleNativeShare = () => {
    navigator.share({ title: `${name} | trails.jp`, text: shareText, url: shareUrl }).catch(() => {
      // ユーザーキャンセル等は無視
    });
  };

  const handleCopy = () => {
    navigator.clipboard?.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  return (
    <div className="flex items-center gap-0.5">
      <a
        href={intentUrl}
        target="_blank"
        rel="noopener noreferrer"
        title="X でシェア"
        className="rounded-full p-1.5 text-muted transition-colors hover:bg-white/10 hover:text-foreground"
      >
        {/* X (旧Twitter) ロゴ */}
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current" aria-hidden="true">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      </a>
      {canNativeShare && (
        <button
          onClick={handleNativeShare}
          title="シェア"
          className="rounded-full p-1.5 text-muted transition-colors hover:bg-white/10 hover:text-foreground"
        >
          <Share2 className="h-3.5 w-3.5" />
        </button>
      )}
      <button
        onClick={handleCopy}
        title={copied ? "コピーしました" : "URL をコピー"}
        className={`rounded-full p-1.5 transition-colors ${
          copied ? "text-green-400" : "text-muted hover:bg-white/10 hover:text-foreground"
        }`}
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <LinkIcon className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

/** ポイント内訳テーブル: 上位3大会を強調、残りは折りたたみ */
function PointBreakdownTable({
  label,
  color,
  ranking,
}: {
  label: string;
  color: "green" | "blue";
  ranking: import("@/lib/analysis/types").RankingAppearance;
}) {
  const [showAll, setShowAll] = useState(false);
  const colorClass = color === "green" ? "text-green-400" : "text-blue-400";
  const bgTop = color === "green" ? "bg-green-500/20 border border-green-500/30" : "bg-blue-500/20 border border-blue-500/30";
  const bgRest = color === "green" ? "bg-green-500/5" : "bg-blue-500/5";

  // ポイント降順で上位3大会を特定
  const withDate = ranking.events.filter((e) => e.date);
  const byPoints = [...withDate].sort((a, b) => b.points - a.points);
  const top3 = byPoints.slice(0, 3);
  const rest = byPoints.slice(3);
  const top3Sum = top3.reduce((s, e) => s + e.points, 0);

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className={`text-[10px] font-bold ${colorClass}`}>{label}</span>
        <span className="text-[10px] text-muted">
          {ranking.rank}位 / 上位3計{" "}
          <span className={`font-bold ${colorClass}`}>
            {top3Sum.toLocaleString()}
          </span>
          <span className="text-muted/60"> ({withDate.length}大会中)</span>
        </span>
      </div>
      <div className="space-y-0.5">
        {top3.map((e, i) => (
          <div
            key={`top-${e.date}-${i}`}
            className={`flex items-center gap-2 rounded px-2 py-1.5 text-[10px] ${bgTop}`}
          >
            <span className={`w-4 flex-shrink-0 font-bold ${colorClass}`}>
              {i + 1}
            </span>
            <span className="w-[4.5rem] flex-shrink-0 font-mono text-muted">{e.date}</span>
            <span className="min-w-0 flex-1 truncate">{e.eventName}</span>
            <span className={`flex-shrink-0 font-mono font-bold ${colorClass}`}>
              {e.points.toLocaleString()}
            </span>
          </div>
        ))}
        {rest.length > 0 && (
          <>
            {showAll && rest.map((e, i) => (
              <div
                key={`rest-${e.date}-${i}`}
                className={`flex items-center gap-2 rounded px-2 py-1 text-[10px] ${bgRest}`}
              >
                <span className="w-4 flex-shrink-0 text-muted/40 font-mono">
                  {i + 4}
                </span>
                <span className="w-[4.5rem] flex-shrink-0 font-mono text-muted/60">{e.date}</span>
                <span className="min-w-0 flex-1 truncate text-muted/80">{e.eventName}</span>
                <span className="flex-shrink-0 font-mono text-muted/60">
                  {e.points.toLocaleString()}
                </span>
              </div>
            ))}
            {/* 展開/閉じるボタン（リスト下部・ボタン体裁） */}
            <button
              onClick={() => setShowAll((v) => !v)}
              className="mt-1 flex w-full items-center justify-center gap-1 rounded-md border border-border bg-surface px-3 py-1.5 text-[10px] font-medium text-muted transition-colors hover:border-primary/30 hover:bg-card-hover hover:text-foreground"
            >
              {showAll ? "閉じる" : `他 ${rest.length} 大会を表示`}
              <ChevronDown className={`h-3 w-3 transition-transform ${showAll ? "rotate-180" : ""}`} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** 特性バッジ + Forest/Sprint 比較バー (Feature 2) */
function TypeBadge({ profile }: { profile: AthleteProfile }) {
  const { forestRank, forestPoints, sprintRank, sprintPoints } = getBestRanks(
    profile.appearances
  );

  const typeColors: Record<string, string> = {
    sprinter: "bg-blue-500/15 text-blue-400",
    forester: "bg-green-500/15 text-green-400",
    allrounder: "bg-purple-500/15 text-purple-400",
    unknown: "bg-white/10 text-muted",
  };

  // 寄りバーの位置は build 側の z-score 正規化 lean を使う（正=Forest寄り/負=Sprint寄り）。
  const lean = profile.forestSprintLean;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center gap-2">
        <Zap className="h-4 w-4 text-primary" />
        <span className="text-xs font-semibold uppercase tracking-wider text-muted">特性分類</span>
      </div>

      <div className="flex items-center gap-3">
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${typeColors[profile.type]}`}>
          {typeLabel(profile.type)}
        </span>
        <span className="text-xs text-muted">
          ランキング掲載: Forest {profile.forestCount}区分 / Sprint {profile.sprintCount}区分
        </span>
      </div>

      {/* Forest vs Sprint 得意度（中央=同等・マーカーが寄っている側が得意）
          位置は z-score 差（種目間のポイント水準差を補正）。生ポイント差だと
          スプリントが全体に高得点なため 77% が Sprint 寄りに偏る（→補正）。
          lean は build 側で両無差別カテゴリ出場時のみ算出。null なら公平に比較不可＝バー非表示。 */}
      {lean != null && (
        <div className="mt-3">
          <div className="mb-1 flex justify-between text-[10px] text-muted">
            <span className="text-green-400">◀ Forest寄り {forestRank !== null ? `(${forestRank}位)` : ""}</span>
            <span className="text-blue-400">Sprint寄り ▶ {sprintRank !== null ? `(${sprintRank}位)` : ""}</span>
          </div>
          <div className="relative h-3 rounded-full bg-white/10">
            <div className="absolute left-1/2 top-0 h-full w-px bg-white/25" />
            <div
              className="absolute top-1/2 h-4 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary transition-all"
              style={{
                left: `${50 - Math.max(-45, Math.min(45, lean * 18))}%`,
              }}
            />
          </div>
          <div className="mt-1 flex justify-between text-[10px] font-mono text-muted">
            <span>{forestPoints.toLocaleString(undefined, { maximumFractionDigits: 1 })}</span>
            <span>{sprintPoints.toLocaleString(undefined, { maximumFractionDigits: 1 })}</span>
          </div>
          <p className="mt-1 text-[9px] text-muted/70">
            ※ 位置は種目間のポイント水準差を補正した相対評価（スプリントは全体に高得点なため単純差では測れない）。下段は実ポイント。
          </p>
        </div>
      )}
    </div>
  );
}

/** スタッツカード: 安定性・調子・ベストスコア */
function StatsCards({ profile }: { profile: AthleteProfile }) {
  const allEvents = useMemo(() => getAllEvents(profile), [profile]);
  const consistency = calcConsistency(allEvents);
  const recentForm = calcRecentForm(allEvents, profile.type, profile);
  const best = allEvents.length > 0
    ? allEvents.reduce((max, e) => (e.points > max.points ? e : max))
    : null;

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {/* 安定性 */}
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="flex items-center gap-1.5">
          <Target className="h-3.5 w-3.5 text-primary" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">安定性</span>
        </div>
        <p className="mt-1 text-2xl font-bold">
          {allEvents.length >= 2 ? `${consistency}` : "—"}
          {allEvents.length >= 2 && <span className="text-sm text-muted">/100</span>}
        </p>
        <p className="text-[10px] text-muted">
          {allEvents.length >= 2
            ? `${consistency >= 70 ? "非常に安定" : consistency >= 40 ? "やや安定" : "ばらつきあり"}（${allEvents.length}戦${allEvents.length < 4 ? "・参考値" : ""}）`
            : "データ不足"}
        </p>
      </div>

      {/* 最近の調子 */}
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="flex items-center gap-1.5">
          {/* n=3 の差分は ±5% 程度がノイズ域 → 色・トレンド矢印は |5%| 以上のみ（過剰演出の回避） */}
          {recentForm >= 5 ? (
            <TrendingUp className="h-3.5 w-3.5 text-green-400" />
          ) : recentForm <= -5 ? (
            <TrendingDown className="h-3.5 w-3.5 text-red-400" />
          ) : (
            <Minus className="h-3.5 w-3.5 text-muted" />
          )}
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">最近の調子</span>
        </div>
        <p className={`mt-1 text-2xl font-bold ${recentForm >= 5 ? "text-green-400" : recentForm <= -5 ? "text-red-400" : ""}`}>
          {allEvents.length >= 2 ? `${recentForm > 0 ? "+" : ""}${recentForm}%` : "—"}
        </p>
        <p className="text-[10px] text-muted">
          直近3大会 vs 全体平均
          {allEvents.length >= 2 && `（${allEvents.length}戦${allEvents.length < 5 ? "・参考値" : ""}）`}
        </p>
      </div>

      {/* ベストスコア */}
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="flex items-center gap-1.5">
          <Zap className="h-3.5 w-3.5 text-yellow-400" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">ベストスコア</span>
        </div>
        <p className="mt-1 text-2xl font-bold text-primary">
          {best ? best.points.toLocaleString() : "—"}
        </p>
        <p className="truncate text-[10px] text-muted">
          {best ? `${best.date} ${best.eventName}` : "—"}
        </p>
      </div>
    </div>
  );
}

type ChartRange = "6m" | "1y" | "2y" | "all";
const CHART_RANGES: { value: ChartRange; label: string }[] = [
  { value: "6m", label: "6ヶ月" },
  { value: "1y", label: "1年" },
  { value: "2y", label: "2年" },
  { value: "all", label: "全期間" },
];

function getChartCutoff(range: ChartRange): string {
  if (range === "all") return "";
  const now = new Date();
  switch (range) {
    case "6m": now.setMonth(now.getMonth() - 6); break;
    case "1y": now.setFullYear(now.getFullYear() - 1); break;
    case "2y": now.setFullYear(now.getFullYear() - 2); break;
  }
  return now.toISOString().slice(0, 10);
}

/** スコア推移チャート — Forest / Sprint 分離 */
function ScoreChart({ profile }: { profile: AthleteProfile }) {
  const [chartRange, setChartRange] = useState<ChartRange>("2y");

  const { forestEvents, sprintEvents, chartData, hasForest, hasSprint } = useMemo(() => {
    // 年齢別・無差別のみ使用（エリートとの混在を防ぐ）
    const fEvents: { date: string; eventName: string; points: number }[] = [];
    const sEvents: { date: string; eventName: string; points: number }[] = [];

    for (const r of profile.rankings) {
      const isF = r.type === "age_forest" && (r.className === "無差別" || r.className === "女子無差別");
      const isS = r.type === "age_sprint" && (r.className === "S_無差別" || r.className === "S_女子無差別");
      if (!isF && !isS) continue;
      for (const e of r.events) {
        if (!e.date) continue;
        if (isF) fEvents.push(e);
        else sEvents.push(e);
      }
    }

    // 日付でまとめる
    const dateMap = new Map<string, { date: string; forest?: number; sprint?: number; fName?: string; sName?: string; forestMa?: number; sprintMa?: number }>();
    for (const e of fEvents) {
      if (!dateMap.has(e.date)) dateMap.set(e.date, { date: e.date });
      const d = dateMap.get(e.date)!;
      d.forest = e.points;
      d.fName = e.eventName;
    }
    for (const e of sEvents) {
      if (!dateMap.has(e.date)) dateMap.set(e.date, { date: e.date });
      const d = dateMap.get(e.date)!;
      d.sprint = e.points;
      d.sName = e.eventName;
    }

    const cutoff = getChartCutoff(chartRange);
    const sorted = [...dateMap.values()]
      .filter((d) => !cutoff || d.date >= cutoff)
      .sort((a, b) => a.date.localeCompare(b.date));

    // トレンド線: Theil–Sen（頑健回帰・レース順ベース）。5点未満は直線を描かない（小標本のトレンドは誤導）
    const fTrend = theilSenTrend(sorted.map((d) => d.forest));
    const sTrend = theilSenTrend(sorted.map((d) => d.sprint));
    const data = sorted.map((d, i) => ({
      ...d,
      forestMa: fTrend[i],
      sprintMa: sTrend[i],
    }));

    return {
      forestEvents: fEvents,
      sprintEvents: sEvents,
      chartData: data,
      hasForest: fEvents.length > 0,
      hasSprint: sEvents.length > 0,
    };
  }, [profile, chartRange]);

  if (chartData.length < 2) {
    return (
      <div className="rounded-lg border border-border bg-card py-8 text-center text-sm text-muted">
        チャート表示には2大会以上のデータが必要です
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
          スコア推移
        </h3>
        <div className="flex items-center gap-3">
          <div className="flex gap-1">
            {CHART_RANGES.map((r) => (
              <button
                key={r.value}
                onClick={() => setChartRange(r.value)}
                className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
                  chartRange === r.value
                    ? "bg-primary/20 text-primary"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <div className="flex gap-3 text-[10px]">
            {hasForest && (
              <span className="flex items-center gap-1 text-green-400">
                <span className="inline-block h-2 w-2 rounded-full bg-green-400" />
                Forest ({forestEvents.length})
              </span>
            )}
            {hasSprint && (
              <span className="flex items-center gap-1 text-blue-400">
                <span className="inline-block h-2 w-2 rounded-full bg-blue-400" />
                Sprint ({sprintEvents.length})
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="h-56 overflow-hidden">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: "#888" }}
              tickFormatter={(v) => v.slice(2, 7)}
              axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
            />
            {/* F/S はスコア体系が異なる（タイプ分類では z 正規化して比較している）ため
                生得点を同一軸に重ねず、左=Forest / 右=Sprint の二軸で描く */}
            {hasForest && (
              <YAxis
                yAxisId="f"
                tick={{ fontSize: 10, fill: "#4ade80" }}
                axisLine={{ stroke: "rgba(74,222,128,0.3)" }}
                domain={["auto", "auto"]}
              />
            )}
            {hasSprint && (
              <YAxis
                yAxisId="s"
                orientation="right"
                tick={{ fontSize: 10, fill: "#60a5fa" }}
                axisLine={{ stroke: "rgba(96,165,250,0.3)" }}
                domain={["auto", "auto"]}
              />
            )}
            <Tooltip
              contentStyle={{
                backgroundColor: "#1a2332",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: "8px",
                fontSize: 12,
              }}
              labelFormatter={(_, payload) => {
                const p = payload?.[0]?.payload;
                if (!p) return "";
                const parts: string[] = [p.date];
                if (p.fName) parts.push(`F: ${p.fName}`);
                if (p.sName) parts.push(`S: ${p.sName}`);
                return parts.join(" | ");
              }}
              formatter={(value, name) => {
                if (String(name).includes("Ma")) return [null as any, null];
                const label = name === "forest" ? "Forest" : "Sprint";
                return [Number(value).toLocaleString(), label];
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: 11 }}
              formatter={(value) => (value === "forest" ? "Forest" : "Sprint")}
            />
            {hasForest && (
              <Line
                name="forest"
                yAxisId="f"
                type="monotone"
                dataKey="forest"
                stroke="#4ade80"
                strokeWidth={2}
                dot={{ fill: "#4ade80", r: 3 }}
                activeDot={{ r: 5 }}
                isAnimationActive={false}
                connectNulls
              />
            )}
            {hasSprint && (
              <Line
                name="sprint"
                yAxisId="s"
                type="monotone"
                dataKey="sprint"
                stroke="#60a5fa"
                strokeWidth={2}
                dot={{ fill: "#60a5fa", r: 3 }}
                activeDot={{ r: 5 }}
                isAnimationActive={false}
                connectNulls
              />
            )}
            {hasForest && (
              <Line
                name="forestMa"
                yAxisId="f"
                type="linear"
                dataKey="forestMa"
                stroke="rgba(74,222,128,0.4)"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                dot={false}
                activeDot={false}
                isAnimationActive={false}
                connectNulls
                legendType="none"
              />
            )}
            {hasSprint && (
              <Line
                name="sprintMa"
                yAxisId="s"
                type="linear"
                dataKey="sprintMa"
                stroke="rgba(96,165,250,0.3)"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                dot={false}
                activeDot={false}
                isAnimationActive={false}
                connectNulls
                legendType="none"
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** 値に応じて濃淡を返す（低=濃い=良い、高=薄い=悪い） */
function valOpacity(value: number, min: number, max: number): number {
  const range = max - min || 1;
  const t = Math.max(0, Math.min(1, (value - min) / range)); // 0=min(good), 1=max(bad)
  return 1 - t * 0.7; // 1.0(濃) → 0.3(薄)
}

/** LapCenter 巡航速度・ミス率推移チャート */
function LapCenterChart({ data, profile }: { data: LapCenterPerformance[]; profile: AthleteProfile }) {
  const [chartRange, setChartRange] = useState<ChartRange>("2y");

  // 信頼度加重トレンド用のレース重み（leg-fingerprint artifact・(種目, 日付) で照合。
  // 同日複数レースは max(w)・artifact に無いレースは theilSenTrend 側で中央値補完＝reliable 扱い）
  const [fpWeights, setFpWeights] = useState<{
    f: Map<string, { w: number; r: 0 | 1 }>;
    s: Map<string, { w: number; r: 0 | 1 }>;
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadLegFingerprint().then((idx) => {
      if (cancelled || !idx) return;
      const a = idx.athletes[profile.name];
      if (!a) return;
      const toMap = (list?: { d: string; w: number; r: 0 | 1 }[]) => {
        const m = new Map<string, { w: number; r: 0 | 1 }>();
        for (const e of list ?? []) {
          const cur = m.get(e.d);
          if (!cur || e.w > cur.w) m.set(e.d, { w: e.w, r: e.r });
        }
        return m;
      };
      setFpWeights({ f: toMap(a.fr), s: toMap(a.sr) });
    });
    return () => {
      cancelled = true;
    };
  }, [profile.name]);

  const { chartData, hasForest, hasSprint, forestCount, sprintCount, speedMin, speedMax, missMin, missMax } = useMemo(() => {
    // JOYランキングからイベント情報を収集: date → [{type, name}]
    const joyByDate = new Map<string, Array<{ type: "forest" | "sprint"; name: string }>>();
    for (const r of profile.rankings) {
      const t = r.type.includes("forest") ? "forest" as const : r.type.includes("sprint") ? "sprint" as const : null;
      if (!t) continue;
      for (const e of r.events) {
        if (!e.date) continue;
        if (!joyByDate.has(e.date)) joyByDate.set(e.date, []);
        const arr = joyByDate.get(e.date)!;
        if (!arr.some((x) => x.type === t)) arr.push({ type: t, name: e.eventName });
      }
    }

    const cutoff = getChartCutoff(chartRange);

    // 同日同イベントは1つにまとめる（Forest/Sprint別）
    const dateMap = new Map<string, {
      date: string;
      fSpeed?: number; sSpeed?: number;
      fMiss?: number; sMiss?: number;
      fName?: string; sName?: string;
    }>();

    let fCount = 0;
    let sCount = 0;

    for (const p of data) {
      if (cutoff && p.d < cutoff) continue;

      // タイプ判定: JOYランキング日付マッチ（日付一致 + 名前近似一致 or 同日1タイプ）
      let type: "forest" | "sprint" | null = null;
      const candidates = joyByDate.get(p.d);
      if (!candidates) continue; // JOYにない日付はスキップ

      const types = new Set(candidates.map((c) => c.type));
      if (types.size === 1) {
        type = candidates[0].type;
      } else {
        for (const c of candidates) {
          if (eventFuzzyMatch(p.e, c.name)) { type = c.type; break; }
        }
      }
      if (!type) continue;

      if (!dateMap.has(p.d)) dateMap.set(p.d, { date: p.d });
      const entry = dateMap.get(p.d)!;

      if (type === "forest") {
        entry.fSpeed = p.s;
        entry.fMiss = p.m;
        entry.fName = p.e;
        fCount++;
      } else {
        entry.sSpeed = p.s;
        entry.sMiss = p.m;
        entry.sName = p.e;
        sCount++;
      }
    }

    const sorted = [...dateMap.values()].sort((a, b) => a.date.localeCompare(b.date));
    const speeds = sorted.flatMap((d) => [d.fSpeed, d.sSpeed].filter((v): v is number => v != null));
    const misses = sorted.flatMap((d) => [d.fMiss, d.sMiss].filter((v): v is number => v != null));

    // トレンド線: Theil–Sen（頑健回帰・レース順ベース）。5点未満は直線を描かない。
    // 重み artifact があれば信頼度加重（方法論 §154: w=クリーンレッグ数×min(出走規模,20)）。
    // reliable（クリーンレッグ≥6かつ規模≥5）と判定できたレースが5本未満なら線を抑制する
    // （artifact に無いレースは reliable 扱い＝メタデータ欠測で既存表示を退行させない）。
    const fSpeedArr = sorted.map((d) => d.fSpeed);
    const sSpeedArr = sorted.map((d) => d.sSpeed);
    const fMissArr = sorted.map((d) => d.fMiss);
    const sMissArr = sorted.map((d) => d.sMiss);
    const mkWeights = (
      values: (number | undefined)[],
      map: Map<string, { w: number; r: 0 | 1 }> | undefined
    ): { arr: (number | undefined)[] | undefined; minPoints: number } => {
      if (!map || map.size === 0) return { arr: undefined, minPoints: 5 };
      const arr = sorted.map((d, i) => (values[i] != null ? map.get(d.date)?.w : undefined));
      let unreliable = 0;
      let shown = 0;
      sorted.forEach((d, i) => {
        if (values[i] == null) return;
        shown++;
        if (map.get(d.date)?.r === 0) unreliable++;
      });
      return { arr, minPoints: shown - unreliable >= 5 ? 5 : Infinity };
    };
    const fW = mkWeights(fSpeedArr, fpWeights?.f);
    const sW = mkWeights(sSpeedArr, fpWeights?.s);
    const fSpeedMa = theilSenTrend(fSpeedArr, fW.minPoints, fW.arr);
    const sSpeedMa = theilSenTrend(sSpeedArr, sW.minPoints, sW.arr);
    const fMissMa = theilSenTrend(fMissArr, fW.minPoints, fW.arr);
    const sMissMa = theilSenTrend(sMissArr, sW.minPoints, sW.arr);

    const withMa = sorted.map((d, i) => ({
      ...d,
      fSpeedMa: fSpeedMa[i],
      sSpeedMa: sSpeedMa[i],
      fMissMa: fMissMa[i],
      sMissMa: sMissMa[i],
    }));

    return {
      chartData: withMa,
      hasForest: fCount > 0,
      hasSprint: sCount > 0,
      forestCount: fCount,
      sprintCount: sCount,
      speedMin: speeds.length > 0 ? Math.min(...speeds) : 0,
      speedMax: speeds.length > 0 ? Math.max(...speeds) : 100,
      missMin: misses.length > 0 ? Math.min(...misses) : 0,
      missMax: misses.length > 0 ? Math.max(...misses) : 100,
    };
  }, [data, chartRange, fpWeights, profile.rankings]);

  if (chartData.length < 2) return null;

  const sharedXAxis = (
    <XAxis
      dataKey="date"
      tick={{ fontSize: 10, fill: "#888" }}
      tickFormatter={(v) => v.slice(2, 7)}
      axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
    />
  );

  const sharedGrid = (
    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
  );

  const tooltipStyle = {
    backgroundColor: "#1a2332",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: "8px",
    fontSize: 12,
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold tracking-wider text-muted">
          巡航速度・ミス率推移
          <span className="ml-1 text-[9px] font-normal">(LapCenter)</span>
        </h3>
        <div className="flex items-center gap-3">
          <div className="flex gap-1">
            {CHART_RANGES.map((r) => (
              <button
                key={r.value}
                onClick={() => setChartRange(r.value)}
                className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
                  chartRange === r.value
                    ? "bg-primary/20 text-primary"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <div className="flex gap-3 text-[10px]">
            {hasForest && (
              <span className="flex items-center gap-1 text-green-400">
                <span className="inline-block h-2 w-2 rounded-full bg-green-400" />
                Forest ({forestCount})
              </span>
            )}
            {hasSprint && (
              <span className="flex items-center gap-1 text-blue-400">
                <span className="inline-block h-2 w-2 rounded-full bg-blue-400" />
                Sprint ({sprintCount})
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 巡航速度チャート */}
      <p className="mb-1 text-[10px] text-muted">巡航速度（小さいほど速い）</p>
      <div className="h-44 overflow-hidden">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            <defs>
              <linearGradient id="lcLineF" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#4ade80" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#4ade80" stopOpacity={1} />
              </linearGradient>
              <linearGradient id="lcLineS" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#60a5fa" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#60a5fa" stopOpacity={1} />
              </linearGradient>
            </defs>
            {sharedGrid}
            {sharedXAxis}
            <YAxis
              tick={{ fontSize: 10, fill: "#888" }}
              axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
              domain={["auto", "auto"]}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              labelFormatter={(_, payload) => {
                const p = payload?.[0]?.payload;
                if (!p) return "";
                const parts: string[] = [p.date];
                if (p.fName) parts.push(`F: ${p.fName}`);
                if (p.sName) parts.push(`S: ${p.sName}`);
                return parts.join(" | ");
              }}
              formatter={(value, name) => {
                if (String(name).includes("Ma")) return [null as any, null];
                return [Number(value).toFixed(1), name === "fSpeed" ? "Forest" : "Sprint"];
              }}
            />
            {hasForest && (
              <Line
                name="fSpeed"
                type="monotone"
                dataKey="fSpeed"
                stroke="url(#lcLineF)"
                strokeWidth={2}
                dot={({ cx, cy, payload }: any) => {
                  const v = payload.fSpeed;
                  if (v == null) return null;
                  const op = valOpacity(v, speedMin, speedMax);
                  return <circle cx={cx} cy={cy} r={3.5} fill={`rgba(74,222,128,${op})`} />;
                }}
                activeDot={{ r: 5, fill: "#4ade80" }}
                isAnimationActive={false}
                connectNulls
              />
            )}
            {hasSprint && (
              <Line
                name="sSpeed"
                type="monotone"
                dataKey="sSpeed"
                stroke="url(#lcLineS)"
                strokeWidth={2}
                dot={({ cx, cy, payload }: any) => {
                  const v = payload.sSpeed;
                  if (v == null) return null;
                  const op = valOpacity(v, speedMin, speedMax);
                  return <circle cx={cx} cy={cy} r={3.5} fill={`rgba(96,165,250,${op})`} />;
                }}
                activeDot={{ r: 5, fill: "#60a5fa" }}
                isAnimationActive={false}
                connectNulls
              />
            )}
            {hasForest && (
              <Line
                name="fSpeedMa"
                type="linear"
                dataKey="fSpeedMa"
                stroke="rgba(74,222,128,0.4)"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                dot={false}
                activeDot={false}
                isAnimationActive={false}
                connectNulls
                legendType="none"
              />
            )}
            {hasSprint && (
              <Line
                name="sSpeedMa"
                type="linear"
                dataKey="sSpeedMa"
                stroke="rgba(96,165,250,0.3)"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                dot={false}
                activeDot={false}
                isAnimationActive={false}
                connectNulls
                legendType="none"
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* ミス率チャート */}
      <p className="mb-1 mt-4 text-[10px] text-muted">ミス率 (%)</p>
      <div className="h-44 overflow-hidden">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            <defs>
              <linearGradient id="lcLineFm" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#4ade80" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#4ade80" stopOpacity={1} />
              </linearGradient>
              <linearGradient id="lcLineSm" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#60a5fa" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#60a5fa" stopOpacity={1} />
              </linearGradient>
            </defs>
            {sharedGrid}
            {sharedXAxis}
            <YAxis
              tick={{ fontSize: 10, fill: "#888" }}
              axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
              domain={[0, "auto"]}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              labelFormatter={(_, payload) => {
                const p = payload?.[0]?.payload;
                if (!p) return "";
                const parts: string[] = [p.date];
                if (p.fName) parts.push(`F: ${p.fName}`);
                if (p.sName) parts.push(`S: ${p.sName}`);
                return parts.join(" | ");
              }}
              formatter={(value, name) => {
                if (String(name).includes("Ma")) return [null as any, null];
                return [`${Number(value).toFixed(1)}%`, name === "fMiss" ? "Forest" : "Sprint"];
              }}
            />
            {hasForest && (
              <Line
                name="fMiss"
                type="monotone"
                dataKey="fMiss"
                stroke="url(#lcLineFm)"
                strokeWidth={2}
                dot={({ cx, cy, payload }: any) => {
                  const v = payload.fMiss;
                  if (v == null) return null;
                  const op = valOpacity(v, missMin, missMax);
                  return <circle cx={cx} cy={cy} r={3.5} fill={`rgba(74,222,128,${op})`} />;
                }}
                activeDot={{ r: 5, fill: "#4ade80" }}
                isAnimationActive={false}
                connectNulls
              />
            )}
            {hasSprint && (
              <Line
                name="sMiss"
                type="monotone"
                dataKey="sMiss"
                stroke="url(#lcLineSm)"
                strokeWidth={2}
                dot={({ cx, cy, payload }: any) => {
                  const v = payload.sMiss;
                  if (v == null) return null;
                  const op = valOpacity(v, missMin, missMax);
                  return <circle cx={cx} cy={cy} r={3.5} fill={`rgba(96,165,250,${op})`} />;
                }}
                activeDot={{ r: 5, fill: "#60a5fa" }}
                isAnimationActive={false}
                connectNulls
              />
            )}
            {hasForest && (
              <Line
                name="fMissMa"
                type="linear"
                dataKey="fMissMa"
                stroke="rgba(74,222,128,0.4)"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                dot={false}
                activeDot={false}
                isAnimationActive={false}
                connectNulls
                legendType="none"
              />
            )}
            {hasSprint && (
              <Line
                name="sMissMa"
                type="linear"
                dataKey="sMissMa"
                stroke="rgba(96,165,250,0.3)"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                dot={false}
                activeDot={false}
                isAnimationActive={false}
                connectNulls
                legendType="none"
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-[9px] text-muted">
        破線＝トレンド（外れ値に強い頑健回帰・レース順ベース・信頼できるレース5本以上で表示。
        <a href="/docs/analysis-system#trend" className="underline hover:text-foreground">算出方法</a>）
      </p>
    </div>
  );
}

/** 最近の大会参加状況 */
function RecentEvents({ profile, lcData }: { profile: AthleteProfile; lcData?: LapCenterPerformance[] | null }) {
  const allEvents = useMemo(() => getAllEvents(profile), [profile]);

  if (allEvents.length === 0) return null;

  // 新しい順にソート
  const recent = [...allEvents].sort((a, b) => b.date.localeCompare(a.date));
  const maxPoints = Math.max(...allEvents.map((e) => e.points));
  const avgPoints = allEvents.reduce((s, e) => s + e.points, 0) / allEvents.length;

  // 成績レベル判定: 平均・標準偏差ベースで5段階
  const variance = allEvents.reduce((s, e) => s + (e.points - avgPoints) ** 2, 0) / allEvents.length;
  const stdDev = Math.sqrt(variance);

  function performanceLevel(points: number): "excellent" | "good" | "average" | "below" | "poor" {
    if (points >= avgPoints + stdDev) return "excellent";
    if (points >= avgPoints + stdDev * 0.3) return "good";
    if (points >= avgPoints - stdDev * 0.3) return "average";
    if (points >= avgPoints - stdDev) return "below";
    return "poor";
  }

  const levelColors = {
    excellent: { bar: "bg-cyan-400/70", text: "text-cyan-400", dot: "bg-cyan-400", bg: "bg-cyan-500/5" },
    good:      { bar: "bg-green-400/50", text: "text-green-400", dot: "bg-green-400", bg: "" },
    average:   { bar: "bg-yellow-400/50", text: "text-yellow-400", dot: "bg-yellow-400", bg: "" },
    below:     { bar: "bg-orange-400/50", text: "text-orange-400", dot: "bg-orange-400", bg: "" },
    poor:      { bar: "bg-red-400/50", text: "text-red-400", dot: "bg-red-400", bg: "bg-red-500/5" },
  };

  // 直近1年の大会数
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const oneYearAgoStr = oneYearAgo.toISOString().slice(0, 10);
  const recentCount = recent.filter((e) => e.date >= oneYearAgoStr).length;

  // 月別データ（直近12ヶ月）: 頻度 + 平均ポイント
  const monthData: Record<string, { count: number; totalPts: number }> = {};
  for (const e of recent) {
    if (e.date >= oneYearAgoStr) {
      const month = e.date.slice(0, 7);
      if (!monthData[month]) monthData[month] = { count: 0, totalPts: 0 };
      monthData[month].count++;
      monthData[month].totalPts += e.points;
    }
  }

  // 12ヶ月分のグリッド生成
  const months: { label: string; key: string; count: number; avgPts: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = `${d.getMonth() + 1}月`;
    const md = monthData[key];
    months.push({
      label,
      key,
      count: md?.count || 0,
      avgPts: md ? md.totalPts / md.count : 0,
    });
  }
  const maxMonthCount = Math.max(...months.map((m) => m.count), 1);

  // LapCenter 取込済みだが JOY ランキング非対象(前日大会等)や古いバンドル欠落で
  // allEvents(=ランキング由来)に行が無いレースを、選手スコープの lcData から「LCのみ行」として補完。
  // 統計(平均/標準偏差/月別)はランキング行のみで計算し、ここでは表示リストだけを union する。
  // 突合は matchLcRace に集約: 同日×同種目を最優先しつつ、LCの種目推定(大会名キーワード)が
  // 「前日大会」等のスプリントを forest と誤判定した場合でも、その日1大会なら出典差を吸収して
  // ランキング行へ紐づける(=「東大大会前日」が2行に重複する不具合の解消)。
  const rankedCountByDate = new Map<string, number>();
  for (const e of recent) rankedCountByDate.set(e.date, (rankedCountByDate.get(e.date) ?? 0) + 1);
  const usedLcRaces = new Set<string>();
  const rankedRows = recent.map((e) => {
    const lcMatch = matchLcRace(lcData, e.date, e.eventName, e.discipline, rankedCountByDate.get(e.date) ?? 1);
    if (lcMatch) usedLcRaces.add(`${lcMatch.d}|${lcMatch.t}|${lcMatch.e}`);
    return { ...e, lcMatch, lcOnly: false };
  });
  const lcOnlyRows = (lcData ?? [])
    .filter((p) => !usedLcRaces.has(`${p.d}|${p.t}|${p.e}`))
    .filter((p, i, arr) => arr.findIndex((q) => q.d === p.d && q.t === p.t && q.e === p.e) === i)
    .map((p) => ({ date: p.d, eventName: p.e, discipline: p.t, points: 0, lcMatch: p, lcOnly: true }));
  const displayRows = [...rankedRows, ...lcOnlyRows].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-primary" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted">
            大会参加状況
          </span>
        </div>
        <span className="text-xs text-muted">
          直近1年: <span className="font-bold text-foreground">{recentCount}</span> 大会 /
          通算: <span className="font-bold text-foreground">{allEvents.length}</span> 大会
        </span>
      </div>

      {/* 凡例 */}
      <div className="mb-3 flex flex-wrap gap-2.5 text-[9px] text-muted">
        {([
          { level: "excellent" as const, label: "好成績" },
          { level: "good" as const, label: "やや良い" },
          { level: "average" as const, label: "平均的" },
          { level: "below" as const, label: "やや低い" },
          { level: "poor" as const, label: "低調" },
        ]).map((l) => (
          <span key={l.level} className="flex items-center gap-1">
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${levelColors[l.level].dot}`} />
            {l.label}
          </span>
        ))}
      </div>

      {/* 月別アクティビティ */}
      <div className="mb-4">
        <p className="mb-1.5 text-[10px] text-muted">月別参加頻度（直近12ヶ月）</p>
        <div className="flex gap-1">
          {months.map((m) => {
            const level = m.count > 0 ? performanceLevel(m.avgPts) : "average";
            return (
              <div key={m.key} className="flex flex-1 flex-col items-center gap-1">
                <div className="flex h-10 w-full items-end justify-center">
                  <div
                    className={`w-full rounded-sm transition-all ${m.count > 0 ? levelColors[level].bar : ""}`}
                    style={{
                      height: m.count > 0 ? `${Math.max((m.count / maxMonthCount) * 100, 15)}%` : "0%",
                    }}
                  />
                </div>
                <span className="text-[8px] text-muted">{m.label}</span>
                {m.count > 0 && (
                  <span className={`text-[8px] font-bold ${levelColors[level].text}`}>{m.count}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 大会リスト */}
      <div className="space-y-1">
        {displayRows.slice(0, 10).map((e, i) => {
          const dt = new Date(e.date + "T00:00:00");
          const dateStr = `${dt.getFullYear()}/${dt.getMonth() + 1}/${dt.getDate()}`;
          const lcMatch = e.lcMatch;
          const isSprint = e.discipline === "sprint";
          // LCのみ行(JOYポイント対象外/バンドル欠落)はポイント無し→中立表示。ランキング行は従来通り色分け。
          const level = e.lcOnly ? null : performanceLevel(e.points);
          const colors = level ? levelColors[level] : null;
          const barWidth = !e.lcOnly && maxPoints > 0 ? (e.points / maxPoints) * 100 : 0;
          return (
            <div
              key={`${e.date}-${e.eventName}-${i}`}
              className={`flex items-center gap-1.5 rounded p-2 ${colors?.bg || "bg-surface"}`}
            >
              <span className={`h-2 w-2 flex-shrink-0 rounded-full ${colors?.dot ?? "bg-muted/40"}`} />
              <span className="w-[3.75rem] flex-shrink-0 text-[11px] font-medium tabular-nums tracking-tight text-muted">
                {dateStr}
              </span>
              <span className={`flex-shrink-0 rounded px-1 py-0.5 text-[9px] font-bold leading-none ${
                isSprint
                  ? "bg-blue-500/15 text-blue-400"
                  : "bg-green-500/15 text-green-400"
              }`}>
                {isSprint ? "S" : "F"}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs">{e.eventName}</span>
              {lcMatch?.c && (
                <span className="hidden flex-shrink-0 items-center gap-1 text-[10px] text-muted sm:flex">
                  <span className="rounded bg-white/5 px-1 py-0.5">{lcMatch.c}</span>
                  {lcMatch.r != null && (
                    <span className="font-mono font-medium text-foreground/80">{lcMatch.r}位</span>
                  )}
                </span>
              )}
              <div className="hidden h-1.5 w-20 overflow-hidden rounded-full bg-white/5 sm:block">
                {!e.lcOnly && colors && (
                  <div
                    className={`h-full rounded-full ${colors.bar}`}
                    style={{ width: `${barWidth}%` }}
                  />
                )}
              </div>
              <span className={`w-12 flex-shrink-0 text-right font-mono text-xs font-bold ${colors?.text ?? "text-muted"}`}>
                {e.lcOnly ? "—" : e.points.toLocaleString()}
              </span>
              {lcMatch && (
                <Link
                  href={`/results/go?e=${encodeURIComponent(lcMatch.e)}&d=${encodeURIComponent(lcMatch.d)}&c=${encodeURIComponent(lcMatch.c)}&athlete=${encodeURIComponent(profile.name)}&disc=${lcMatch.t}`}
                  className="flex-shrink-0 rounded bg-primary/15 px-1.5 py-0.5 text-[9px] font-bold text-primary transition-colors hover:bg-primary/25"
                  title="このレースのレッグ分析"
                >
                  レッグ▸
                </Link>
              )}
            </div>
          );
        })}
      </div>

      {displayRows.length > 10 && (
        <p className="mt-2 text-center text-[10px] text-muted">
          直近10大会を表示（全{displayRows.length}大会・レッグ分析あり {displayRows.filter((r) => r.lcMatch).length}）
        </p>
      )}
    </div>
  );
}

