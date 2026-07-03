"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, X } from "lucide-react";
import type { LapCenterRunnerDetail } from "@/lib/scraper/lapcenter-detail";
import { lapStrToSeconds } from "@/lib/scraper/lapcenter-detail";
import type { LapCenterPerformance } from "@/lib/analysis/types";
import {
  buildLegView,
  buildLegPrizes,
  deriveAve3PerLeg,
  legLabel,
  fmtSignedSeconds,
  normalizeName,
  type LegView,
  type LegCell,
} from "@/lib/results/leg-analysis";

interface Props {
  eventId: number;
  classId: number;
  athlete: string | null; // 主役（選手ページから来た選手）。null ならデフォルト=上位
  discipline: "forest" | "sprint" | null; // 自己平均比の種目（athlete 経由時のみ）
  excludeDate: string | null;
  eventName: string | null; // 文脈ヘッダー用（events から解決）
  eventDate: string | null;
  className: string | null; // クラス名（resolver から cn で受領）
}

const norm = normalizeName; // 名前正規化は leg-analysis に集約（レビュー H: 二重定義解消）

/**
 * 結果分析・レッグ分析（①）。relay-first：LapCenter の per-leg 値を整形表示。
 * 1人＝深掘りカード（自己平均比・ノーミス推定・ロス横バー）/ 複数＝比較グリッド を自動切替。
 * recharts を使わず純 CSS/SVG のみ → iOS WebContent OOM の懸念なし。
 */
export function LegAnalysisClient({
  eventId,
  classId,
  athlete,
  discipline,
  excludeDate,
  eventName,
  eventDate,
  className,
}: Props) {
  const [runners, setRunners] = useState<LapCenterRunnerDetail[] | null>(null);
  const [history, setHistory] = useState<LapCenterPerformance[] | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "empty" | "error">("loading");
  const [selected, setSelected] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setRunners(null);
    setSelected(null);
    const loadSplit = fetch(`/api/lc-split/${eventId}/${classId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { runners: LapCenterRunnerDetail[] }) => {
        if (cancelled) return;
        if (!d.runners || d.runners.length === 0) {
          setStatus("empty");
          return;
        }
        setRunners(d.runners);
        setStatus("ok");
        // 既定列: 上位3名。選手ページ経由ならその選手を先頭に加える。
        const finishers = [...d.runners].filter((r) => r.rank != null).sort((a, b) => a.rank! - b.rank!);
        const top = finishers.slice(0, 3).map((r) => r.name);
        const aName = athlete ? d.runners.find((r) => norm(r.name) === norm(athlete))?.name : undefined;
        const def = aName && !top.includes(aName) ? [aName, ...top].slice(0, 4) : top;
        setSelected(def.length ? def : d.runners.slice(0, 1).map((r) => r.name));
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });

    const loadHistory = athlete
      ? fetch(`/api/lc/${encodeURIComponent(athlete)}`)
          .then((r) => (r.ok ? (r.json() as Promise<LapCenterPerformance[]>) : null))
          .then((h) => {
            if (!cancelled) setHistory(h);
          })
          .catch(() => {
            if (!cancelled) setHistory(null);
          })
      : Promise.resolve();

    Promise.all([loadSplit, loadHistory]);
    return () => {
      cancelled = true;
    };
  }, [eventId, classId, athlete]);

  const athleteName = useMemo(
    () => (athlete && runners ? runners.find((r) => norm(r.name) === norm(athlete))?.name ?? null : null),
    [athlete, runners],
  );

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        <span className="ml-2 text-sm text-muted">スプリットを読み込み中...</span>
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted">
        スプリットの取得に失敗しました。
        <br />
        LapCenter (mulka2) が一時的に応答しない可能性があります。時間をおいて再度お試しください。
      </div>
    );
  }
  if (status === "empty" || !runners || !selected) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted">
        このクラスのスプリットデータが見つかりませんでした。
      </div>
    );
  }

  const orderByRank = (names: string[]) =>
    [...names].sort((a, b) => {
      const ra = runners.find((r) => r.name === a)?.rank ?? 9999;
      const rb = runners.find((r) => r.name === b)?.rank ?? 9999;
      return ra - rb;
    });

  const MAX_COLS = 8; // 比較列の上限（超ワイドDOM→iOSレイアウト負荷を防ぐ・レビュー L）
  const add = (name: string) =>
    setSelected((cur) => (cur && !cur.includes(name) && cur.length < MAX_COLS ? orderByRank([...cur, name]) : cur));
  const remove = (name: string) => setSelected((cur) => (cur && cur.length > 1 ? cur.filter((n) => n !== name) : cur));

  const ordered = orderByRank(selected);
  const nFin = runners.filter((r) => r.rank != null).length;

  return (
    <div>
      {/* 文脈ヘッダー: どのレースを見ているか（レビュー I） */}
      <div className="mb-4">
        <h1 className="text-lg font-bold leading-tight">
          <Link href={`/results/${eventId}`} className="transition-colors hover:text-primary hover:underline" title="他のクラスを選ぶ">
            {eventName ?? "レース分析"}
          </Link>
          {className && <span className="ml-1.5 text-sm font-semibold text-muted">{className}</span>}
        </h1>
        <p className="mt-0.5 text-[11px] text-muted">
          {[eventDate, nFin ? `${nFin}名完走` : null, "LapCenter レッグ分析"].filter(Boolean).join(" ・ ")}
          {" ・ "}
          <Link href={`/results/${eventId}`} className="text-primary hover:underline">
            他のクラス →
          </Link>
        </p>
      </div>
      {athlete && athleteName === null && (
        <div className="mb-3 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-2.5 text-[11px] leading-relaxed text-yellow-200/90">
          このレースに「{athlete}」の記録が見つかりませんでした（氏名の表記揺れ等の可能性）。代わりに上位選手を表示しています。
        </div>
      )}
      <AddPicker runners={runners} selected={ordered} onAdd={add} />
      {ordered.length === 1 ? (
        <SingleView
          runners={runners}
          name={ordered[0]}
          isAthlete={ordered[0] === athleteName}
          discipline={discipline}
          history={history}
          excludeDate={excludeDate}
        />
      ) : (
        <CompareGrid runners={runners} names={ordered} athleteName={athleteName} onRemove={remove} />
      )}
      <LegPrizeBoardView runners={runners} athleteName={athleteName} />
      <Glossary />

      <p className="mt-4 text-center text-[10px] leading-relaxed text-muted">
        データ: LapCenter (mulka2.com) を trails.jp が再構成（表示時点の掲載内容・最大1時間程度のキャッシュ）。基準=上位3平均(Ave3)。
      </p>
    </div>
  );
}

/** ③ 区間賞ボード（折りたたみ）: 各レッグ最速＝区間賞。獲得数ランキング＋レッグ別最速。レース全体の読み物。 */
function LegPrizeBoardView({ runners, athleteName }: { runners: LapCenterRunnerDetail[]; athleteName: string | null }) {
  const board = useMemo(() => buildLegPrizes(runners), [runners]);
  const [open, setOpen] = useState(false);
  if (!board || board.legs.length === 0) return null;
  const top = board.tally.slice(0, 8);
  const maxCount = Math.max(...top.map((t) => t.count), 1);
  const subjectKey = athleteName ? norm(athleteName) : null;
  return (
    <div className="mt-5 rounded-2xl border border-border bg-card p-4">
      <p className="text-[11px] tracking-wider text-muted">区間賞 獲得数（各レッグの最速＝区間1位）</p>
      <div className="mt-2 space-y-1">
        {top.map((t, i) => {
          const isSubj = subjectKey != null && norm(t.name) === subjectKey;
          const w = (t.count / maxCount) * 100;
          return (
            <div key={`${t.name}-${i}`} className="flex items-center gap-2 text-xs">
              <span className="w-4 flex-shrink-0 text-right font-mono text-[10px] text-muted">{i + 1}</span>
              <span
                className={`w-24 flex-shrink-0 truncate sm:w-32 ${isSubj ? "font-bold text-primary" : "text-foreground"}`}
                title={t.club ? `${t.name}（${t.club}）` : t.name}
              >
                {t.name}
              </span>
              <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-border">
                <div className={`h-full rounded-full ${isSubj ? "bg-primary" : "bg-primary/45"}`} style={{ width: `${w}%` }} />
              </div>
              <span className="w-11 flex-shrink-0 text-right font-mono font-bold tabular-nums">
                {t.count}
                <span className="ml-0.5 text-[9px] font-normal text-muted">区間</span>
              </span>
            </div>
          );
        })}
      </div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="mt-3 text-[11px] font-medium text-primary transition-colors hover:underline"
      >
        {open ? "レッグ別の最速を閉じる ▲" : "レッグ別の最速を見る ▼"}
      </button>
      {open && (
        <div className="mt-2 overflow-hidden rounded-lg border border-border">
          {board.legs.map((p, i) => {
            const isSubj = subjectKey != null && p.winner != null && norm(p.winner) === subjectKey;
            return (
              <div
                key={p.legIndex}
                className={`flex items-center gap-3 px-2.5 py-1.5 text-xs ${i % 2 ? "bg-surface/50" : ""}`}
              >
                <span className="w-12 flex-shrink-0 font-mono text-muted">{p.label}</span>
                <span className={`min-w-0 flex-1 truncate ${isSubj ? "font-bold text-primary" : "text-foreground"}`}>
                  {p.winner ?? "—"}
                </span>
                <span className="flex-shrink-0 font-mono text-muted">{p.time}</span>
              </div>
            );
          })}
        </div>
      )}
      <p className="mt-2 text-[9px] text-muted/70">区間賞＝そのレッグの最速タイム。獲得数が多い＝多くの区間でトップ。</p>
    </div>
  );
}

/** 用語グロッサリ（折りたたみ・レビュー N）。初心者向けに指標の意味を説明。 */
function Glossary() {
  const terms: [string, string][] = [
    ["基準（上位平均）", "そのレッグの上位3名の平均タイム(Ave3)。各自の評価基準。"],
    ["巡航速度", "ミスを除いた走りの速さの指標。小さいほど速い（100=基準ペース）。"],
    ["ミス率", "記録に占めるロス時間の割合。小さいほど良い。"],
    ["ロス（区間ロス）", "そのレッグで基準より余計にかかった秒数。負＝基準より速い。"],
    ["理想（ノーミスタイム）", "自分の巡航ペースでミスなく走ったときの想定タイム（= 記録 − 総ロス）。"],
    ["ノーミス推定順位（深掘り）", "この選手がノーミスで走った場合、実際の結果に対して何位だったか（理想タイム vs 他者の実記録）。"],
    ["比較相手とのタイム差", "各CPでの自分と比較相手の実経過タイム差。上=遅れ・下=リード。段差が大きいレッグで差がついた。"],
    ["区間順位", "そのレッグ単独での順位（完走者中）。"],
    ["平均比", "自分の同種目(Forest/Sprint別)平均との差。負＝平均より良い。"],
    ["罠レッグ vs 自分のミス", "自分のロスをフィールド全体と比較。フィールド中央値も大きい＝罠レッグ(コースが難しく皆ロス)、フィールドは速いのに自分だけ＝自分のミス。コース起因(フィールド中央値)と自分の超過に分解。"],
    ["区間賞", "そのレッグの最速タイム（区間1位）。獲得数が多いほど多くの区間でトップ。"],
  ];
  return (
    <details className="mt-4 rounded-lg border border-border bg-card/50 p-3 text-[11px] text-muted">
      <summary className="cursor-pointer font-semibold text-foreground/80">用語の説明</summary>
      <dl className="mt-2 space-y-1.5 leading-relaxed">
        {terms.map(([t, d]) => (
          <div key={t}>
            <dt className="inline font-semibold text-foreground/80">{t}</dt>
            <dd className="inline"> — {d}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

/** 列追加ピッカー（未選択の完走者を順位順に） */
function AddPicker({
  runners,
  selected,
  onAdd,
}: {
  runners: LapCenterRunnerDetail[];
  selected: string[];
  onAdd: (name: string) => void;
}) {
  if (selected.length >= 8) {
    return <div className="mb-3 text-center text-[10px] text-muted">比較は最大8名です（✕で外すと追加できます）</div>;
  }
  // 完走者(rank付き)のみ比較に追加可能（DNF/MP は per-leg 配列が短く列が壊れるため除外・レビュー A）。全完走者を選択可。
  const eligible = [...runners]
    .filter((r) => r.rank != null && !selected.includes(r.name))
    .sort((a, b) => a.rank! - b.rank!);
  if (eligible.length === 0) return null;
  return (
    <div className="mb-3 flex items-center gap-2">
      <label className="text-[11px] text-muted">選手追加</label>
      <select
        value=""
        onChange={(e) => e.target.value && onAdd(e.target.value)}
        className="flex-1 rounded-lg border border-border bg-surface px-2 py-2.5 text-sm outline-none focus:border-primary"
      >
        <option value="">＋ 比較に追加…</option>
        {eligible.map((r) => (
          <option key={`${r.name}-${r.index}`} value={r.name}>
            {r.rank != null ? `${r.rank}位 ` : "—位 "}
            {r.name}
            {r.club ? ` (${r.club})` : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

/* ───────────────────────── 単一選手＝深掘りカード ───────────────────────── */

function SingleView({
  runners,
  name,
  isAthlete,
  discipline,
  history,
  excludeDate,
}: {
  runners: LapCenterRunnerDetail[];
  name: string;
  isAthlete: boolean;
  discipline: "forest" | "sprint" | null;
  history: LapCenterPerformance[] | null;
  excludeDate: string | null;
}) {
  const view = useMemo<LegView | null>(() => {
    const useSelf = isAthlete && discipline != null && history != null;
    return buildLegView(
      runners,
      name,
      useSelf ? { discipline, history: history!, excludeDate: excludeDate ?? undefined } : undefined,
    );
  }, [runners, name, isAthlete, discipline, history, excludeDate]);

  // 累積カーブの比較相手（既定=1位、自分が1位なら2位）。ユーザーが切替可能。
  const [overlayName, setOverlayName] = useState<string | null>(null);

  if (!view) return null;
  const s = view.subject;
  const self = view.self;
  const maxAbs = Math.max(...view.legs.map((l) => Math.abs(l.lossSec)), 1);
  const maxMissIndex = view.topMistakes[0]?.index ?? -1;

  // 比較相手（既定=1位、自分が1位なら2位）。ユーザーが切替可能。
  const byRank = runners.filter((r) => r.rank != null).sort((a, b) => a.rank! - b.rank!);
  const subjIsTop = byRank[0] && norm(byRank[0].name) === norm(view.subject.name);
  const defaultOverlay = (subjIsTop ? byRank[1] : byRank[0]) ?? null;
  const picked = overlayName ? runners.find((r) => r.name === overlayName) ?? null : null;
  const overlayRunner = picked && picked.name !== view.subject.name ? picked : defaultOverlay;
  // 累積タイム差: 各CPでの「自分 − 比較相手」の実経過タイム差（秒）。＋=比較相手より後ろ（遅い）。
  // legLossTime（各自の巡航ペース基準）を重ねると基準が別々で比較にならないため、共通の実経過タイムで差を取る。
  const subjRunner = runners.find((r) => norm(r.name) === norm(view.subject.name)) ?? null;
  const gapSeries = (() => {
    if (!overlayRunner || !subjRunner) return null;
    const n = Math.min(subjRunner.elapsedTime.length, overlayRunner.elapsedTime.length);
    if (n < 2) return null;
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = lapStrToSeconds(subjRunner.elapsedTime[i]);
      const b = lapStrToSeconds(overlayRunner.elapsedTime[i]);
      if (a == null || b == null) return null;
      out.push(a - b);
    }
    return out;
  })();
  // 差が最も開いたレッグ（gap の単区間増分が最大）
  const gapJumpIndex = (() => {
    if (!gapSeries) return -1;
    let idx = 0;
    let mx = gapSeries[0];
    for (let i = 1; i < gapSeries.length; i++) {
      const d = gapSeries[i] - gapSeries[i - 1];
      if (d > mx) {
        mx = d;
        idx = i;
      }
    }
    return idx;
  })();

  return (
    <div>
      <div className="rounded-2xl border border-border bg-card p-4">
        <h2 className="text-xl font-extrabold">
          <Link
            href={`/analysis?athlete=${encodeURIComponent(norm(s.name))}`}
            className="transition-colors hover:text-primary hover:underline"
            title="この選手のページへ"
          >
            {s.name}
          </Link>
        </h2>
        <p className="mt-0.5 text-xs text-muted">{s.club || "—"}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Chip label="記録" value={s.result} sub={s.rank != null ? `${s.rank}位/${view.n}` : `—/${view.n}`} accent />
          <Chip label="巡航速度" value={s.speed != null ? String(s.speed) : "—"} delta={self.speedDelta} />
          <Chip label="ミス率" value={s.lossRate != null ? `${s.lossRate}%` : "—"} delta={self.lossRateDelta} />
          <Chip label="理想" value={s.idealTime || "—"} />
        </div>
        {self.discipline && self.avgSpeed != null && (
          <p className="mt-2 text-[10px] leading-relaxed text-muted">
            「平均比」= 自分の {self.discipline === "forest" ? "Forest" : "Sprint"} 平均（{self.sampleSize}戦 / 巡航{" "}
            {self.avgSpeed}・ミス率 {self.avgLossRate}%）との差。緑=平均より良い。種目別に集計。
          </p>
        )}
        <div className="mt-3 border-t border-border pt-2.5 text-xs leading-relaxed text-muted">
          ノーミスなら <span className="text-green-400">{s.idealTime}</span>（総ロス {s.totalLossTime}）
          {view.idealRank != null && (
            <>
              。あなたがノーミスなら <span className="text-primary">{view.idealRank}位</span>相当
            </>
          )}
          。
          {view.topMistakes.length > 0 && (
            <>
              {" "}主因は{" "}
              {view.topMistakes.map((m, i) => (
                <span key={m.index}>
                  {i > 0 && "・"}
                  <span className="text-red-400">
                    {m.label} {m.lossStr}
                  </span>
                </span>
              ))}
              。
            </>
          )}
        </div>
      </div>

      {view.cumulativeLoss.length >= 2 && (
        <div className="mt-5 rounded-2xl border border-border bg-card p-4">
          {gapSeries && overlayRunner ? (
            <>
              <p className="text-[11px] tracking-wider text-muted">比較相手とのタイム差（どこで差がついたか）</p>
              <p className="mb-1 text-[10px] text-muted/80">
                縦＝比較相手より何秒 遅い(上)／速い(下)。段差の大きいレッグでタイム差がついた。橙＝最も開いたレッグ。
              </p>
              <GapChart legs={view.legs} gap={gapSeries} jumpIndex={gapJumpIndex} />
              <div className="mt-1 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[10px] text-muted">
                <span className="flex items-center gap-1">
                  <i className="inline-block h-0.5 w-3 align-middle" style={{ background: "#f87171" }} /> 自分（{view.subject.name}）
                </span>
                <span className="flex items-center gap-1">
                  <i className="inline-block h-0.5 w-3 align-middle" style={{ background: "#fbbf24" }} />
                  基準＝比較相手:
                  <select
                    value={overlayRunner.name}
                    onChange={(e) => setOverlayName(e.target.value)}
                    className="rounded border border-border bg-surface px-1 py-0.5 text-[10px] outline-none focus:border-primary"
                  >
                    {byRank
                      .filter((r) => r.name !== view.subject.name)
                      .map((r) => (
                        <option key={`${r.name}-${r.index}`} value={r.name}>
                          {r.rank}位 {r.name}
                        </option>
                      ))}
                  </select>
                </span>
              </div>
            </>
          ) : null}
          <p className="mb-1 mt-3 text-[11px] tracking-wider text-muted">
            総ロスの内訳（<span className="font-mono text-red-400">{s.totalLossTime}</span>）— あなたのミスの累積（自分の巡航ペース基準）
          </p>
          <CompositionBar legs={view.legs} maxLegIndex={maxMissIndex} />
          <div className="mt-1 flex justify-between text-[10px] text-muted">
            <span>S</span>
            <span>各レッグの幅＝総ロスに占める割合</span>
            <span>F</span>
          </div>
        </div>
      )}

      {view.n >= 5 &&
        (() => {
          // 罠レッグ判定: 自分の各ロスを「コース起因(フィールド中央値) + 自分の超過」に分解。
          const FLOOR = 5; // これ未満の小ロスは判定対象外（秒）
          const rows = view.legs
            .flatMap((l, i) => {
              const your = l.lossSec;
              const fieldMed = l.fieldMedianLossSec;
              if (your <= FLOOR || fieldMed == null) return [];
              const course = Math.max(0, Math.min(fieldMed, your)); // コース起因はフィールド中央値（自分のロスで頭打ち）
              const own = your - course; // 自分の超過
              const ratio = your > 0 ? course / your : 0;
              const verdict = ratio >= 0.5 ? "trap" : ratio <= 0.2 ? "own" : "mixed";
              return [{ i, label: l.label, your, course, own, verdict }];
            })
            .sort((a, b) => b.your - a.your)
            .slice(0, 6);
          if (rows.length === 0) return null;
          const totCourse = rows.reduce((s, r) => s + r.course, 0);
          const totOwn = rows.reduce((s, r) => s + r.own, 0);
          return (
            <div className="mt-5 rounded-2xl border border-border bg-card p-4">
              <p className="text-[11px] tracking-wider text-muted">罠レッグ vs 自分のミス</p>
              <p className="mb-2 text-[10px] text-muted/80">
                各ロスをフィールド全体と比較。フィールドも遅い＝<span className="text-warning">罠レッグ（コース要因）</span>／フィールドは速いのに自分だけ＝<span className="text-red-400">自分のミス</span>。
                {view.n < 8 && <span className="text-muted/60">（n&lt;8 は参考値）</span>}
              </p>
              <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]">
                <span className="text-muted">上位ロスの内訳:</span>
                <span className="text-warning">コース起因 {fmtSignedSeconds(totCourse)}</span>
                <span className="text-red-400">自分の超過 {fmtSignedSeconds(totOwn)}</span>
              </div>
              <div className="space-y-1.5">
                {rows.map((r) => {
                  const cw = r.your > 0 ? (r.course / r.your) * 100 : 0;
                  return (
                    <div key={r.i} className="flex items-center gap-2 text-xs">
                      <span className="w-12 flex-shrink-0 font-mono text-muted">{r.label}</span>
                      <span className="w-12 flex-shrink-0 text-right font-mono font-bold text-red-400">{fmtSignedSeconds(r.your)}</span>
                      <div className="flex h-2 flex-1 overflow-hidden rounded-full bg-border" title={`コース起因 ${fmtSignedSeconds(r.course)} / 自分の超過 ${fmtSignedSeconds(r.own)}`}>
                        <div className="h-full bg-warning/70" style={{ width: `${cw}%` }} />
                        <div className="h-full bg-red-400/80" style={{ width: `${100 - cw}%` }} />
                      </div>
                      <span className={`w-16 flex-shrink-0 text-right text-[10px] font-bold ${
                        r.verdict === "trap" ? "text-warning" : r.verdict === "own" ? "text-red-400" : "text-muted"
                      }`}>
                        {r.verdict === "trap" ? "罠レッグ" : r.verdict === "own" ? "自分のミス" : "半々"}
                      </span>
                    </div>
                  );
                })}
              </div>
              <p className="mt-1.5 text-[9px] text-muted/70">
                コース起因 ≈ フィールドのロス中央値、自分の超過 = 自分のロス − コース起因。LapCenter/WinSplits はフィールド分布を出さないため判定不能。
              </p>
            </div>
          );
        })()}

      <p className="mb-2 mt-5 px-1 text-[11px] tracking-wider text-muted">
        レッグ別 ロス（基準＝上位平均 / 緑=基準より速い）
      </p>
      <div className="space-y-[7px]">
        {view.legs.map((leg, i) => (
          <LegRow key={i} leg={leg} n={view.n} maxAbs={maxAbs} />
        ))}
      </div>

      <div className="mt-2 flex justify-center gap-4 text-[10px] text-muted">
        <Legend color="#f87171" label="ロス（ミス）" />
        <Legend color="#4ade80" label="ゲイン（基準超え）" />
        <Legend color="#f97316" label="大ミス上位3" />
      </div>
    </div>
  );
}

function Chip({
  label,
  value,
  sub,
  delta,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  delta?: number | null;
  accent?: boolean;
}) {
  return (
    <span className="rounded-lg border border-border bg-border px-2.5 py-1.5 text-xs text-muted">
      {label}{" "}
      <b className={accent ? "text-base font-bold text-primary" : "text-[15px] font-bold text-foreground"}>{value}</b>
      {sub && <span className="ml-1 text-[10px]">({sub})</span>}
      {delta != null && (
        <span className="ml-1 text-[11px] font-semibold" style={{ color: deltaColor(delta) }}>
          (平均比 {delta > 0 ? "+" : ""}
          {delta})
        </span>
      )}
    </span>
  );
}

function LegRow({ leg, n, maxAbs }: { leg: LegCell; n: number; maxAbs: number }) {
  const w = Math.min(48, (Math.abs(leg.lossSec) / maxAbs) * 48);
  const rankColor = rankToColor(leg.lapRank, n);
  return (
    <div
      className={`flex items-center gap-2.5 rounded-xl border bg-card px-3 py-2.5 ${
        leg.isTopMiss ? "border-red-400/45" : "border-border"
      }`}
      style={leg.isTopMiss ? { background: "linear-gradient(0deg,rgba(248,113,113,.07),rgba(248,113,113,.07)),var(--card)" } : undefined}
    >
      <div className="w-[46px] flex-shrink-0 rounded-md bg-border py-2 text-center font-mono text-xs font-bold text-muted">
        {leg.label}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2.5">
          <span className="font-mono text-[17px] font-bold">{leg.lap}</span>
          <span className="text-[11px] text-muted">基準 {leg.ave3Str}</span>
          <span className="ml-auto text-[11px] font-semibold" style={{ color: rankColor }}>
            区間{leg.lapRank ?? "—"}位<span className="font-normal text-muted">/{n}</span>
          </span>
        </div>
        <LossBar lossSec={leg.lossSec} widthPct={w} />
      </div>
      <div className="w-16 flex-shrink-0 text-right">
        <span className="font-mono text-sm font-bold" style={{ color: lossColor(leg.lossSec) }}>
          {leg.lossStr}
        </span>
        {leg.isTopMiss && (
          <span className="mt-0.5 block rounded bg-red-400 px-1 py-0.5 text-[9px] font-bold text-white">大ミス</span>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────── 複数選手＝比較グリッド ───────────────────────── */

function CompareGrid({
  runners,
  names,
  athleteName,
  onRemove,
}: {
  runners: LapCenterRunnerDetail[];
  names: string[];
  athleteName: string | null;
  onRemove: (name: string) => void;
}) {
  const subjects = names.map((n) => runners.find((r) => r.name === n)).filter(Boolean) as LapCenterRunnerDetail[];
  const n = runners.filter((r) => r.rank != null).length;
  // 列ごとに長さが違っても全レッグ行を出す（短い列は "—"）。subjects[0] 依存をやめる（レビュー A）。
  const legCount = subjects.length ? Math.max(...subjects.map((r) => r.lapTime.length)) : 0;
  const ave3 = useMemo(() => deriveAve3PerLeg(runners, legCount), [runners, legCount]);

  const lossesByCol = subjects.map((r) => r.legLossTime.map((t) => lapStrToSeconds(t) ?? 0));
  const maxAbs = Math.max(...lossesByCol.flat().map((v) => Math.abs(v)), 1);

  // グリッドでは「ノーミス順位」は出さない（各列の理想 vs 実フィールドは全員1位判定になり混乱、
  // 理想同士の順位は本人の「自分がノーミスなら何位」の問いに答えない）。理想タイムのみ並べて比較。

  return (
    <>
    <p className="mb-2 text-left text-[10px] text-muted/80">
      単一選手のみにすると、比較相手とのタイム差・自己平均比つきの「深掘りカード」になります。
    </p>
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-max min-w-full border-separate border-spacing-0 text-xs">
        <thead>
          <tr>
            <th className="sticky left-0 z-20 min-w-[70px] border-b border-r border-border bg-surface px-2 py-1.5 text-left">
              レッグ
            </th>
            {subjects.map((r) => (
              <th
                key={`${r.name}-${r.index}`}
                className={`sticky top-0 z-10 min-w-[86px] border-b border-border bg-surface px-2 py-1.5 ${
                  r.name === athleteName ? "border-b-2 !border-b-primary" : ""
                }`}
              >
                <div className="flex flex-col items-center gap-0.5">
                  <span className="text-[10px] font-bold text-primary">{r.rank ?? "—"}位</span>
                  <Link
                    href={`/analysis?athlete=${encodeURIComponent(norm(r.name))}`}
                    className="max-w-[78px] truncate text-[11px] font-bold transition-colors hover:text-primary hover:underline"
                    title={`${r.name}（選手ページへ）`}
                  >
                    {r.name}
                  </Link>
                  <button
                    onClick={() => onRemove(r.name)}
                    title="この列を消す"
                    aria-label={`${r.name} を比較から外す`}
                    className="mt-0.5 rounded bg-border-strong px-2 py-1 text-muted transition-colors hover:bg-red-400 hover:text-white"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: legCount }, (_, i) => (
            <tr key={i}>
              <th className="sticky left-0 z-10 border-b border-r border-border bg-surface px-2 py-1 text-left">
                <div className="font-mono text-xs font-bold text-muted">{legLabel(i, legCount)}</div>
                <div className="text-[9px] text-muted/80">基準 {ave3[i] != null ? fmtSignedSeconds(ave3[i]!).replace(/^\+/, "") : "—"}</div>
              </th>
              {subjects.map((r, ci) => {
                const hasLeg = i < r.lapTime.length;
                const loss = lossesByCol[ci][i] ?? 0;
                const w = Math.min(46, (Math.abs(loss) / maxAbs) * 46);
                return (
                  <td
                    key={`${r.name}-${i}`}
                    className="border-b border-border px-2 py-1.5 text-center"
                    style={{ background: hasLeg ? cellBg(loss, maxAbs) : "transparent" }}
                  >
                    <div className="font-mono text-sm font-bold leading-tight">{hasLeg ? r.lapTime[i] : "—"}</div>
                    {hasLeg && <LossBar lossSec={loss} widthPct={w} thin />}
                    {hasLeg && (
                      <div className="mt-0.5 font-mono text-[10px] font-bold" style={{ color: lossColor(loss) }}>
                        {fmtSignedSeconds(loss)}
                        <span className="ml-1 font-normal text-muted">{r.lapRank[i] ?? "—"}位</span>
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
          <FootRow label="記録" subjects={subjects} render={(r) => r.result} />
          <FootRow label="巡航速度" subjects={subjects} render={(r) => (r.speed ?? "—").toString()} />
          <FootRow label="ミス率" subjects={subjects} render={(r) => `${r.lossRate ?? "—"}%`} />
          <tr>
            <th className="sticky left-0 z-10 border-r border-t border-border bg-surface px-2 py-1.5 text-left text-[11px] font-semibold text-muted">
              ノーミスタイム
            </th>
            {subjects.map((r) => (
              <td key={`ideal-${r.name}`} className="border-t border-border bg-surface px-2 py-1.5 text-center">
                <div className="font-mono font-bold text-green-400">{r.idealTime || "—"}</div>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
    <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1 text-[10px] text-muted">
      <Legend color="#f87171" label="セル赤=ロス（悪）" />
      <Legend color="#4ade80" label="セル緑=基準より速い（良）" />
      <span>巡航速度・ミス率は小さいほど良い</span>
    </div>
    </>
  );
}

function FootRow({
  label,
  subjects,
  render,
}: {
  label: string;
  subjects: LapCenterRunnerDetail[];
  render: (r: LapCenterRunnerDetail) => string;
}) {
  return (
    <tr>
      <th className="sticky left-0 z-10 border-r border-t border-border bg-surface px-2 py-1.5 text-left text-[11px] font-semibold text-muted">
        {label}
      </th>
      {subjects.map((r) => (
        <td key={`${label}-${r.name}`} className="border-t border-border bg-surface px-2 py-1.5 text-center font-bold">
          {render(r)}
        </td>
      ))}
    </tr>
  );
}

/* ───────────────────────── 共通 ───────────────────────── */

function LossBar({ lossSec, widthPct, thin }: { lossSec: number; widthPct: number; thin?: boolean }) {
  return (
    <div className={`relative ${thin ? "mt-1 h-1" : "mt-[7px] h-1.5"} rounded-full bg-border`}>
      <div className="absolute -top-0.5 bottom-[-2px] left-1/2 w-px bg-border-strong" />
      <div
        className="absolute bottom-0 top-0 rounded-full"
        style={
          lossSec >= 0
            ? { left: "50%", width: `${widthPct}%`, background: "linear-gradient(90deg,#f8717188,#f87171)" }
            : { right: "50%", width: `${widthPct}%`, background: "linear-gradient(270deg,#4ade8088,#4ade80)" }
        }
      />
    </div>
  );
}

/** 比較相手とのタイム差カーブ（pure SVG）。縦=各CPでの「自分−比較相手」の実経過タイム差秒。
 *  0=比較相手の基準線（金）。＋(上)=遅れ、−(下)=リード。橙=差が最も開いたレッグ。 */
function GapChart({ legs, gap, jumpIndex }: { legs: LegCell[]; gap: number[]; jumpIndex: number }) {
  const L = gap.length;
  if (L < 2) return null;
  const W = 420;
  const H = 150;
  const padL = 8;
  const padR = 18;
  const padT = 18;
  const padB = 18;
  const lo = Math.min(0, ...gap);
  const hi = Math.max(0, ...gap);
  const xs = (i: number) => padL + (i / (L - 1)) * (W - padL - padR);
  const ys = (v: number) => padT + (1 - (v - lo) / (hi - lo || 1)) * (H - padT - padB);
  const baseY = ys(0);
  const area = `M ${xs(0)} ${baseY} ` + gap.map((v, i) => `L ${xs(i)} ${ys(v)}`).join(" ") + ` L ${xs(L - 1)} ${baseY} Z`;
  const line = gap.map((v, i) => `${i === 0 ? "M" : "L"} ${xs(i)} ${ys(v)}`).join(" ");
  const xLab = (i: number) => (i === 0 ? "S" : i === L - 1 ? "F" : String(i));
  const finalGap = gap[L - 1];
  const jumpDelta = jumpIndex > 0 ? gap[jumpIndex] - gap[jumpIndex - 1] : 0;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 h-auto w-full" preserveAspectRatio="xMidYMid meet" role="img" aria-label="比較相手とのタイム差">
      <path d={area} fill="rgba(248,113,113,.16)" />
      {/* 比較相手=基準線(0)・金 */}
      <line x1={padL} y1={baseY} x2={W - padR} y2={baseY} stroke="#fbbf24" strokeWidth={1.2} strokeDasharray="3 2" />
      <path d={line} fill="none" stroke="#f87171" strokeWidth={2} />
      {gap.map((v, i) => (
        <circle key={i} cx={xs(i)} cy={ys(v)} r={i === jumpIndex ? 3.4 : 2} fill={i === jumpIndex ? "#f97316" : "#f87171"} />
      ))}
      {jumpIndex > 0 && (
        <>
          <line x1={xs(jumpIndex)} y1={ys(gap[jumpIndex])} x2={xs(jumpIndex)} y2={padT} stroke="#f97316" strokeDasharray="2 2" strokeWidth={1} />
          <text x={xs(jumpIndex)} y={padT - 4} fill="#f97316" fontSize={9} textAnchor="middle">
            {legs[jumpIndex]?.label} {fmtSignedSeconds(jumpDelta)}
          </text>
        </>
      )}
      {/* 終点＝最終タイム差 */}
      <text x={xs(L - 1)} y={ys(finalGap) + (finalGap >= 0 ? -5 : 11)} fill="#f87171" fontSize={9} fontWeight="bold" textAnchor="end">
        {fmtSignedSeconds(finalGap)}
      </text>
      {gap.map((v, i) =>
        i % 2 === 0 || i === L - 1 ? (
          <text key={`x${i}`} x={xs(i)} y={H - 5} fill="var(--muted)" fontSize={8} textAnchor="middle">
            {xLab(i)}
          </text>
        ) : null,
      )}
    </svg>
  );
}

/** ② 総ロスの構成バー（各レッグの正ロスを横に積み上げ）。 */
function CompositionBar({ legs, maxLegIndex }: { legs: LegCell[]; maxLegIndex: number }) {
  const pos = legs.map((l, i) => ({ i, v: l.lossSec, label: l.label, lossStr: l.lossStr })).filter((x) => x.v > 0);
  const totalPos = pos.reduce((s, x) => s + x.v, 0) || 1;
  const maxLoss = Math.max(...legs.map((l) => l.lossSec), 1);
  let left = 0;
  return (
    <div className="relative mt-1 h-6 overflow-hidden rounded-md bg-border">
      {pos.map(({ i, v, label, lossStr }) => {
        const w = (v / totalPos) * 100;
        const l = left;
        left += w;
        const big = i === maxLegIndex;
        return (
          <div
            key={i}
            title={`${label}: ${lossStr}`}
            className="absolute bottom-0 top-0 border-r border-background"
            style={{ left: `${l}%`, width: `${w}%`, background: big ? "#f97316" : `rgba(248,113,113,${(0.35 + (v / maxLoss) * 0.5).toFixed(3)})` }}
          />
        );
      })}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <i className="inline-block h-2.5 w-2.5 rounded-sm align-[-1px]" style={{ background: color }} />
      {label}
    </span>
  );
}

function lossColor(sec: number): string {
  return sec > 0 ? "#f87171" : sec < 0 ? "#4ade80" : "var(--muted)";
}
function deltaColor(delta: number): string {
  return delta < 0 ? "#4ade80" : delta > 0 ? "#f87171" : "var(--muted)";
}
function rankToColor(rank: number | null, n: number): string {
  const pct = rank != null ? rank / n : 1;
  return pct <= 0.15 ? "#4ade80" : pct <= 0.5 ? "var(--foreground)" : "var(--negative)";
}
function cellBg(loss: number, maxAbs: number): string {
  const t = Math.min(1, Math.abs(loss) / maxAbs);
  if (loss > 0) return `rgba(248,113,113,${(0.1 + t * 0.38).toFixed(3)})`;
  if (loss < 0) return `rgba(74,222,128,${(0.08 + t * 0.22).toFixed(3)})`;
  return "transparent";
}
