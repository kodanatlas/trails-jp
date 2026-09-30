"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, X } from "lucide-react";
import type { DisciplineDetail } from "@/lib/analysis/leg-fingerprint-details";
import {
  buildDrilldown,
  drilldownHref,
  excludedSummary,
  fieldSummary,
  formatDelta,
  formatLap,
  sortDrilldownRows,
  type DrilldownOrder,
  type DrilldownRow,
  type DrilldownSelection,
  type FieldSummary,
} from "@/lib/analysis/leg-fingerprint-drilldown";
import { FIELD_JUDGE_MIN_N, type FieldVerdict } from "@/lib/results/leg-field-judge";
import { FullText } from "@/components/FullText";

/**
 * ミスの傾向カードのセル（または規模バー）を開いたときの根拠レッグ一覧（インラインパネル）。
 * docs/plans/2026-09-30_miss-trend-drilldown.md §4.2
 */

export type DrilldownLoadState = "loading" | "error" | "stale" | "ok";

const PAGE = 20;
const PHASE_LABELS = ["序盤", "中盤", "終盤"];
const LEN_LABELS = ["短", "中", "長"];
const PHASE_DEF = ["最初", "中央", "最後"];
const LEN_DEF = ["短い", "中くらいの", "長い"];
const REASON_LABEL = {
  pack: "集団走の疑いが過半のため",
  clean: "判定に使えるレッグが6本未満のため",
} as const;

interface Props {
  selection: DrilldownSelection;
  detail: DisciplineDetail | null;
  state: DrilldownLoadState;
  onRetry: () => void;
  onClose: () => void;
  athleteKey: string;
  discipline: "forest" | "sprint";
  sevBins: [number, number];
  sevLabels: [string, string, string];
}

function title(selection: DrilldownSelection, sevLabels: [string, string, string]): string {
  if (selection.kind === "sev") return `ミスの規模「${sevLabels[selection.bin]}」`;
  return `${PHASE_LABELS[Math.floor(selection.cell / 3)]}×${LEN_LABELS[selection.cell % 3]}レッグ`;
}

/** セルの定義（局面・レッグ長）を1行ずつ。1文にまとめると語の途中で折れるため分ける */
function definitions(selection: DrilldownSelection): string[] {
  if (selection.kind === "sev") return [];
  const p = Math.floor(selection.cell / 3);
  const len = selection.cell % 3;
  return [
    `${PHASE_LABELS[p]}＝コースのレッグを3等分した${PHASE_DEF[p]}の区間`,
    `${LEN_LABELS[len]}レッグ＝同じレース内の基準所要時間で、おおむね${LEN_DEF[len]}1/3`,
  ];
}

/** 件数の行。セルで n<5 はカード本体と同じく率を出さない＝「データ不足」 */
function countLine(selection: DrilldownSelection, n: number, m: number): string {
  if (selection.kind === "sev") return `ミス判定 ${m} レッグ`;
  return n < 5 ? `データ不足（ミス判定 ${m} / ${n} レッグ）` : `ミス判定 ${m} / ${n} レッグ`;
}

export function LegFingerprintDrilldown(props: Props) {
  const { selection, detail, state, onRetry, onClose, sevLabels } = props;
  const panelTitle = title(selection, sevLabels);
  return (
    <div
      className="mt-2 scroll-mt-20 rounded-lg border border-primary/40 bg-card p-3"
      role="region"
      aria-label={`${panelTitle}の根拠レッグ`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-bold">{panelTitle}</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="閉じる"
          className="-m-1 rounded p-1 text-muted transition-colors hover:bg-white/10 hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {state === "loading" && <p className="mt-2 text-[11px] text-muted">根拠レッグを読み込み中…</p>}
      {state === "error" && (
        <p className="mt-2 text-[11px] text-muted">
          読み込めませんでした。
          <button type="button" onClick={onRetry} className="ml-1 underline hover:text-foreground">
            再試行
          </button>
        </p>
      )}
      {state === "stale" && (
        <p className="mt-2 text-[11px] text-muted">データ更新中のため、根拠レッグは表示できません。しばらくしてから再度お試しください。</p>
      )}
      {state === "ok" && detail && <PanelBody {...props} detail={detail} />}
    </div>
  );
}

function PanelBody({ selection, detail, athleteKey, discipline, sevBins }: Props & { detail: DisciplineDetail }) {
  const [order, setOrder] = useState<DrilldownOrder>("date");
  const [shown, setShown] = useState(PAGE);
  const [showClean, setShowClean] = useState(false);
  const dd = buildDrilldown(detail, selection, sevBins, discipline);
  const defs = definitions(selection);
  const missRows = sortDrilldownRows(dd.miss, order);
  const summary = fieldSummary(dd.miss);
  // 規模バーから開いたときは全行が同じ規模なのでタグを出さない
  const rowProps = { athleteKey, discipline, showSev: selection.kind === "cell" };

  return (
    <div className="mt-1.5 space-y-2">
      <p className="text-[11px] text-foreground/85">{countLine(selection, dd.n, dd.m)}</p>
      {summary && <FieldSummaryLine summary={summary} />}
      {defs.length > 0 && (
        <ul className="space-y-0.5 text-[10px] leading-relaxed text-muted">
          {defs.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}
      {selection.kind === "cell" && (
        <p className="text-[10px] leading-relaxed text-muted">
          赤いセルは、このセル全体が自分の平均より偏って多いという判定です。個々のレッグに統計的な判定はありません。
        </p>
      )}
      <p className="text-[10px] leading-relaxed text-muted">
        各行の数字は、想定タイム（自分の巡航ペースで走った場合）との差です。
      </p>

      {dd.miss.length > 0 && (
        <div className="flex gap-1 text-[10px]" role="group" aria-label="並び順">
          {(["date", "delta"] as const).map((o) => (
            <button
              key={o}
              type="button"
              aria-pressed={order === o}
              onClick={() => setOrder(o)}
              className={`rounded px-2 py-0.5 ${order === o ? "bg-primary/20 font-semibold text-foreground" : "text-muted hover:text-foreground"}`}
            >
              {o === "date" ? "日付順" : "想定との差が大きい順"}
            </button>
          ))}
        </div>
      )}

      <RowList rows={missRows.slice(0, shown)} grouped={order === "date"} {...rowProps} />
      {missRows.length > shown && (
        <button type="button" onClick={() => setShown((s) => s + PAGE)} className="w-full rounded border border-border py-1 text-[10px] text-muted hover:text-foreground">
          もっと見る（残り {missRows.length - shown} 件）
        </button>
      )}

      {dd.clean.length > 0 && (
        <div>
          <button
            type="button"
            aria-expanded={showClean}
            onClick={() => setShowClean((v) => !v)}
            className="text-[10px] text-muted underline hover:text-foreground"
          >
            {showClean ? "ミス判定なしのレッグを閉じる" : `ミス判定なし ${dd.clean.length} レッグを表示`}
          </button>
          {showClean && <CleanList rows={sortDrilldownRows(dd.clean, "date")} {...rowProps} />}
        </div>
      )}

      <ExcludedNote detail={detail} />
      <p className="text-[9px] leading-relaxed text-muted/80">
        ミス判定は、想定タイムを30%以上上回ったレッグの機械判定で、ナビゲーションのミスとは限りません（地形・集団走・ルート選択を含みえます）。コースの難所かどうかは各レースのレッグ分析で確認できます。
      </p>
      {summary && (
        <p className="text-[9px] leading-relaxed text-muted/80">
          <span className="text-warning">難レッグ</span>＝同じクラスの完走者（本人を除く）の多くも遅れたレッグ、
          <span className="text-red-400">自分のミス</span>＝完走者の多くは遅れていないレッグ。完走者の中央値による目安で、原因の断定ではありません。比べられる完走者が{FIELD_JUDGE_MIN_N}名未満のレッグには付けません。値は取込時点のデータで、レッグ分析の表示と異なることがあります。
        </p>
      )}
    </div>
  );
}

function CleanList({
  rows,
  athleteKey,
  discipline,
  showSev,
}: {
  rows: DrilldownRow[];
  athleteKey: string;
  discipline: "forest" | "sprint";
  showSev: boolean;
}) {
  const [shown, setShown] = useState(PAGE);
  return (
    <div className="mt-1.5 space-y-1.5">
      <RowList rows={rows.slice(0, shown)} grouped athleteKey={athleteKey} discipline={discipline} showSev={showSev} />
      {rows.length > shown && (
        <button type="button" onClick={() => setShown((s) => s + PAGE)} className="w-full rounded border border-border py-1 text-[10px] text-muted hover:text-foreground">
          もっと見る（残り {rows.length - shown} 件）
        </button>
      )}
    </div>
  );
}

function RowList({
  rows,
  grouped,
  athleteKey,
  discipline,
  showSev,
}: {
  rows: DrilldownRow[];
  grouped: boolean;
  athleteKey: string;
  discipline: "forest" | "sprint";
  showSev: boolean;
}) {
  return (
    <ul className="space-y-1">
      {rows.map((row, i) => {
        const newRace = !grouped || i === 0 || rows[i - 1].raceIdx !== row.raceIdx;
        return (
          <li key={`${row.raceIdx}-${row.legIdx}`}>
            {newRace && <RaceMeta row={row} />}
            <LegLink row={row} href={drilldownHref(row, athleteKey, discipline)} showSev={showSev} />
          </li>
        );
      })}
    </ul>
  );
}

function RaceMeta({ row }: { row: DrilldownRow }) {
  return (
    <p className="mt-1.5 flex min-w-0 gap-1.5 text-[10px] text-muted">
      <span className="flex-shrink-0 font-mono">{row.date.replace(/-/g, "/")}</span>
      <FullText className="min-w-0 truncate">{row.event}</FullText>
      {row.className && <span className="flex-shrink-0">{row.className}</span>}
    </p>
  );
}

// 「中」だけだと「中レッグ」と読まれるため「中ミス」（結果分析ページの「大ミス」と同じ語）
const SEV_TEXT = ["小ミス", "中ミス", "大ミス"] as const;

// 結果分析ページの「難レッグ vs 自分のミス」と同じ語・同じ色（FieldComparisonCard）
const FIELD_TEXT: Record<FieldVerdict, string> = { trap: "難レッグ", own: "自分のミス", mixed: "半々" };
const FIELD_TONE: Record<FieldVerdict, string> = { trap: "text-warning", own: "text-red-400", mixed: "text-muted" };

/** ミス判定の内訳（件数 0 の区分は出さない。判定なしは理由別） */
function FieldSummaryLine({ summary }: { summary: FieldSummary }) {
  const parts: { key: string; text: string; tone: string }[] = [
    { key: "own", text: `自分のミス ${summary.own}`, tone: FIELD_TONE.own },
    { key: "mixed", text: `半々 ${summary.mixed}`, tone: FIELD_TONE.mixed },
    { key: "trap", text: `難レッグ ${summary.trap}`, tone: FIELD_TONE.trap },
    { key: "few", text: `判定なし（少人数） ${summary.few}`, tone: "text-muted" },
    { key: "none", text: `判定なし（比較データなし） ${summary.none}`, tone: "text-muted" },
  ].filter((p) => summary[p.key as keyof FieldSummary] > 0);
  return (
    <p className="flex flex-wrap gap-x-2 gap-y-0.5 text-[10px]">
      <span className="text-muted">うち</span>
      {parts.map((p) => (
        <span key={p.key} className={`whitespace-nowrap ${p.tone}`}>
          {p.text}
        </span>
      ))}
    </p>
  );
}

function LegLink({ row, href, showSev }: { row: DrilldownRow; href: string; showSev: boolean }) {
  const tone = row.miss ? "text-negative" : row.deltaSec < 0 ? "text-green-400" : "text-muted";
  // 少人数・比較データなしの行には何も出さない（要約で件数だけ示す）
  const verdict: FieldVerdict | null =
    row.field === "trap" || row.field === "own" || row.field === "mixed" ? row.field : null;
  return (
    <Link
      href={href}
      className="flex items-center gap-1.5 rounded bg-surface px-1.5 py-1.5 text-[11px] transition-colors hover:bg-card-hover"
    >
      <span className="w-11 flex-shrink-0 rounded bg-tag py-0.5 text-center font-mono text-[10px] text-muted">{row.legLabel}</span>
      <span className="w-10 flex-shrink-0 text-right font-mono tabular-nums">{formatLap(row.lapSec)}</span>
      <FullText className={`min-w-0 flex-1 truncate ${tone}`}>{formatDelta(row.deltaSec, row.deltaPct)}</FullText>
      {/* 規模とフィールド比較は縦に積む（横に並べると iPhone 幅で差の数字が切れる） */}
      {((showSev && row.sevBin != null) || verdict) && (
        <span className="flex flex-shrink-0 flex-col items-end gap-0.5 leading-none">
          {showSev && row.sevBin != null && (
            <span className="rounded bg-negative/15 px-1 py-px text-[9px] text-negative">{SEV_TEXT[row.sevBin]}</span>
          )}
          {verdict && <span className={`text-[9px] font-bold ${FIELD_TONE[verdict]}`}>{FIELD_TEXT[verdict]}</span>}
        </span>
      )}
      <ChevronRight className="h-3 w-3 flex-shrink-0 text-muted/60" />
    </Link>
  );
}

function ExcludedNote({ detail }: { detail: DisciplineDetail }) {
  const [open, setOpen] = useState(false);
  const s = excludedSummary(detail);
  if (s.races.length === 0 && s.packLegs === 0 && s.packUnchecked === 0) return null;
  return (
    <div className="text-[10px] text-muted">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="underline hover:text-foreground">
        {open ? "集計対象外を閉じる" : "集計対象外（この種目全体）"}
      </button>
      {open && (
        <div className="mt-1 space-y-0.5">
          {s.races.map((race, i) => (
            <div key={i}>
              <p className="flex min-w-0 gap-1.5">
                <span className="flex-shrink-0 font-mono">{race.date.replace(/-/g, "/")}</span>
                <FullText className="min-w-0 truncate">{race.event}</FullText>
                {race.className && <span className="flex-shrink-0">{race.className}</span>}
              </p>
              <p className="pl-2 text-muted/80">{REASON_LABEL[race.reason]}、レース全体を除外</p>
            </div>
          ))}
          {s.packLegs > 0 && <p>集団走の疑いで除外したレッグ {s.packLegs} 本</p>}
          {s.packUnchecked > 0 && <p>スタート時刻不明で集団走を未チェック {s.packUnchecked} レース</p>}
        </div>
      )}
    </div>
  );
}
