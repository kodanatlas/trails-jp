"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { Swords, Search, X, Loader2, ExternalLink, ChevronDown } from "lucide-react";
import type { AthleteIndex, AthleteSummary, AthleteProfile } from "@/lib/analysis/types";
import type { AthleteEntryRef } from "@/lib/entries/index-types";
import { loadAthleteDetail } from "@/lib/analysis/utils";
import {
  scoreCandidates,
  tallyH2H,
  hasMergedNamesakes,
  type Tally,
} from "@/lib/analysis/head-to-head";
import type { LegH2HResult } from "@/lib/analysis/leg-h2h";

interface Props {
  /** 自分（AthleteDetail がロード済みのプロフィール） */
  profile: AthleteProfile;
  athleteIndex: AthleteIndex;
  /** 自分の出場予定エントリー（AthleteDetail がロード済み。null = 取得失敗） */
  myEntries: AthleteEntryRef[] | null;
}

/** 再戦予定（joe_event_id で交差した今後の大会） */
interface Rematch {
  joeEventId: number;
  date: string;
  eventName: string;
  joeUrl: string;
  sameClass: boolean;
  classNames: string[];
}

/** JST (UTC+9) の今日 YYYY-MM-DD（UpcomingEntries と同一ロジック） */
function todayJst(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/** 選手詳細の Head-to-Head 対戦成績セクション */
export function HeadToHead({ profile, athleteIndex, myEntries }: Props) {
  const [opponent, setOpponent] = useState<AthleteSummary | null>(null);
  const [oppProfile, setOppProfile] = useState<AthleteProfile | null>(null);
  const [oppEntries, setOppEntries] = useState<AthleteEntryRef[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [legH2H, setLegH2H] = useState<LegH2HResult | null>(null);

  // 相手データの結果キャッシュ（77シャードの遅延 fetch を選手切替のたびに繰り返さない）
  const profileCache = useRef(new Map<string, AthleteProfile>());
  const entriesCache = useRef(new Map<string, AthleteEntryRef[]>());

  // 相手の選択/解除（effect 内の同期 setState を避けるためハンドラ側でリセット）
  const selectOpponent = (a: AthleteSummary | null) => {
    setOpponent(a);
    setOppProfile(null);
    setOppEntries(null);
    setLegH2H(null);
    setShowAllHistory(false);
    setLoading(a !== null);
  };

  // 相手選択時にプロフィール＋エントリーをロード（stale レスポンスの後勝ち上書き防止ガード付き）
  useEffect(() => {
    if (!opponent) return;
    let cancelled = false;
    const cachedProfile = profileCache.current.get(opponent.name);
    const loadProfile = cachedProfile
      ? Promise.resolve(cachedProfile)
      : loadAthleteDetail(opponent).then((p) => {
          profileCache.current.set(opponent.name, p);
          return p;
        });
    const cachedEntries = entriesCache.current.get(opponent.name);
    const loadEntries = cachedEntries
      ? Promise.resolve(cachedEntries)
      : fetch(`/api/athletes/${encodeURIComponent(opponent.name)}/entries`)
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => {
            const entries: AthleteEntryRef[] = d?.entries ?? [];
            entriesCache.current.set(opponent.name, entries);
            return entries;
          })
          .catch(() => [] as AthleteEntryRef[]);
    Promise.all([loadProfile, loadEntries]).then(([p, e]) => {
      if (cancelled) return;
      setOppProfile(p);
      setOppEntries(e);
      setLoading(false);
    });
    // レッグ勝敗（同一クラスで対戦したレースのみ・非致命）
    fetch(
      `/api/h2h-legs?a=${encodeURIComponent(profile.name)}&b=${encodeURIComponent(opponent.name)}`,
    )
      .then((r) => (r.ok ? (r.json() as Promise<LegH2HResult>) : null))
      .then((d) => {
        if (!cancelled) setLegH2H(d && d.races.length > 0 ? d : null);
      })
      .catch(() => {
        if (!cancelled) setLegH2H(null);
      });
    return () => {
      cancelled = true;
    };
  }, [opponent, profile.name]);

  // 検索結果（部分一致 上位8件、自分自身は除外）
  const results = useMemo(() => {
    if (!query) return [];
    const isAsciiOnly = /^[\x00-\x7F]+$/.test(query);
    if (isAsciiOnly && query.length < 2) return [];
    const q = query.toLowerCase();
    return Object.values(athleteIndex.athletes)
      .filter(
        (a) =>
          a.name !== profile.name &&
          (a.name.toLowerCase().includes(q) || a.clubs.some((c) => c.toLowerCase().includes(q)))
      )
      .sort((a, b) => a.bestRank - b.bestRank)
      .slice(0, 8);
  }, [athleteIndex, query, profile.name]);

  // デフォルト候補チップ: 「成績が近い選手」を同クラブ・他クラブ両方から提示（純ロジックは lib）。
  const candidates = useMemo(() => scoreCandidates(profile, athleteIndex), [profile, athleteIndex]);

  // 対戦成績の集計（純ロジックは lib）: 共通クラスの得点を大会単位で突合し勝敗＋平均得点差を出す。
  const h2h = useMemo(
    () => (oppProfile ? tallyH2H(profile.rankings, oppProfile.rankings) : null),
    [profile, oppProfile],
  );

  // 相手が同姓同名の別人合成の疑い（検索経由で選ばれた場合。候補チップは除外済み）
  const oppHasNamesakes = opponent != null && hasMergedNamesakes(opponent);

  // 再戦予定: 両者のエントリーを JST 今日以降にフィルタ → joe_event_id で交差
  // （同一 id 複数行ありうるので Map<joe_event_id, rows[]> で集約してから判定）
  const rematches = useMemo<Rematch[]>(() => {
    if (!oppEntries) return [];
    const today = todayJst();
    const collect = (entries: AthleteEntryRef[] | null) => {
      const map = new Map<number, AthleteEntryRef[]>();
      for (const e of entries ?? []) {
        if (e.date < today) continue;
        const arr = map.get(e.joe_event_id);
        if (arr) arr.push(e);
        else map.set(e.joe_event_id, [e]);
      }
      return map;
    };
    const mine = collect(myEntries);
    const theirs = collect(oppEntries);
    const out: Rematch[] = [];
    for (const [id, myRows] of mine) {
      const oppRows = theirs.get(id);
      if (!oppRows) continue;
      const myClasses = new Set(myRows.map((e) => e.className));
      const shared = [...new Set(oppRows.map((e) => e.className))].filter((c) => myClasses.has(c));
      out.push({
        joeEventId: id,
        date: myRows[0].date,
        eventName: myRows[0].eventName,
        joeUrl: myRows[0].joeUrl,
        sameClass: shared.length > 0,
        classNames: shared,
      });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }, [myEntries, oppEntries]);

  const formatDate = (date: string) => {
    const dt = new Date(date + "T00:00:00");
    return `${dt.getFullYear()}/${dt.getMonth() + 1}/${dt.getDate()}`;
  };

  const tallyText = (t: Tally) => `${t.win}勝${t.loss}敗${t.draw}分`;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      {/* ヘッダー */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Swords className="h-4 w-4 text-primary" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted">
            対戦成績 (Head-to-Head)
          </span>
        </div>
        {opponent && (
          <button
            onClick={() => {
              selectOpponent(null);
              setQuery("");
            }}
            className="flex items-center gap-1 rounded px-2 py-1 text-[10px] text-muted transition-colors hover:bg-white/10 hover:text-foreground"
          >
            <X className="h-3 w-3" />
            相手を変更
          </button>
        )}
      </div>

      {!opponent ? (
        <>
          {/* 相手検索 */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
            <input
              type="text"
              placeholder="対戦相手を検索..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setTimeout(() => setFocused(false), 200)}
              className="w-full rounded-lg border border-border bg-surface py-2 pl-8 pr-3 text-sm outline-none focus:border-primary"
            />
            {focused && results.length > 0 && (
              <div className="absolute left-0 right-0 top-full z-10 mt-1 rounded-lg border border-border bg-card shadow-xl">
                {results.map((a) => (
                  <button
                    key={a.name}
                    onMouseDown={() => {
                      selectOpponent(a);
                      setQuery(a.name);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-card-hover"
                  >
                    <span className="font-medium">{a.name}</span>
                    <span className="text-[10px] text-muted">{a.clubs[0]}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* デフォルト候補チップ */}
          {candidates.length > 0 && (
            <div className="mt-3">
              <p className="mb-1.5 text-[10px] text-muted">候補（成績が近い選手・同クラブ／他クラブ）</p>
              <div className="flex flex-wrap gap-1.5">
                {candidates.map(({ athlete, label }) => (
                  <button
                    key={athlete.name}
                    onClick={() => selectOpponent(athlete)}
                    className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-[11px] transition-colors hover:border-primary/40 hover:bg-card-hover"
                  >
                    <span className="font-medium">{athlete.name}</span>
                    <span className="text-[9px] text-muted">{label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      ) : loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span className="ml-2 text-xs text-muted">対戦データを読み込み中...</span>
        </div>
      ) : !oppProfile || !h2h ? null : (
        <>
          {/* 勝敗サマリ */}
          <div className="rounded bg-surface p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-primary">{profile.name}</p>
                <p className="truncate text-[10px] text-muted">{profile.clubs[0] ?? ""}</p>
              </div>
              <div className="flex-shrink-0 text-center">
                <p className="text-xl font-bold">{tallyText(h2h.total)}</p>
                <p className="text-[9px] text-muted">全 {h2h.records.length} 戦</p>
              </div>
              <div className="min-w-0 flex-1 text-right">
                <p className="truncate text-sm font-bold text-accent">{oppProfile.name}</p>
                <p className="truncate text-[10px] text-muted">{oppProfile.clubs[0] ?? ""}</p>
              </div>
            </div>
            {h2h.records.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[10px]">
                {h2h.forest.win + h2h.forest.loss + h2h.forest.draw > 0 && (
                  <span className="text-green-400">Forest {tallyText(h2h.forest)}</span>
                )}
                {h2h.sprint.win + h2h.sprint.loss + h2h.sprint.draw > 0 && (
                  <span className="text-blue-400">Sprint {tallyText(h2h.sprint)}</span>
                )}
                {h2h.avgPointDiff != null && (
                  <span className="text-muted">
                    平均得点差{" "}
                    <span
                      className={`font-bold ${
                        h2h.avgPointDiff > 0
                          ? "text-primary"
                          : h2h.avgPointDiff < 0
                            ? "text-accent"
                            : "text-foreground"
                      }`}
                    >
                      {h2h.avgPointDiff > 0 ? "+" : ""}
                      {h2h.avgPointDiff.toLocaleString()}点
                    </span>
                  </span>
                )}
              </div>
            )}
          </div>

          {oppHasNamesakes && (
            <p className="mt-2 rounded bg-amber-500/10 px-2 py-1 text-[9px] text-amber-300/90">
              ※ この選手は同姓同名の別人が混ざっている可能性があります（成績が過大に見えることがあります）
            </p>
          )}

          <p className="mt-2 text-[9px] text-muted/70">
            ※ JOY ランキング換算点での比較です（同一大会でも別クラス出走の場合があります）
          </p>

          {/* レッグ勝敗（同一クラス＝同一コースを走ったレースのみ・区間タイム比較） */}
          {legH2H && (
            <div className="mt-2 rounded bg-surface p-3">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                  レッグ勝敗
                </span>
                <span className="text-[10px] text-muted">
                  同一クラスで対戦 {legH2H.races.length} レース・{legH2H.legs} レッグ
                </span>
              </div>
              <p className="mt-1 text-center text-lg font-bold">
                <span className="text-primary">{legH2H.wonA}</span>
                <span className="mx-1 text-xs text-muted">勝</span>
                <span className="text-accent">{legH2H.wonB}</span>
                <span className="mx-1 text-xs text-muted">敗</span>
                {legH2H.tied > 0 && (
                  <span className="text-xs text-muted">（{legH2H.tied}分）</span>
                )}
              </p>
              <div className="mt-1.5 space-y-0.5">
                {legH2H.races.slice(0, 5).map((r, i) => (
                  <div key={`${r.date}-${i}`} className="flex items-center gap-2 text-[10px]">
                    <span className="w-16 flex-shrink-0 font-mono text-muted">{formatDate(r.date)}</span>
                    <span className="min-w-0 flex-1 truncate text-muted">{r.eventName}</span>
                    <span className="flex-shrink-0 font-mono">
                      <span className="font-bold text-primary">{r.wonA}</span>
                      <span className="text-muted/60">-</span>
                      <span className="font-bold text-accent">{r.wonB}</span>
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-1.5 text-[9px] text-muted/70">
                区間タイムが相手より速かったレッグの数（同一クラス＝同一コースのみ）。
              </p>
            </div>
          )}

          {/* 対戦履歴 */}
          {h2h.records.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted">
              共通のランキング掲載大会がありません
            </p>
          ) : (
            <div className="mt-2">
              {/* 列ヘッダー（左=自分 / 右=相手） */}
              <div className="mb-1 flex items-center gap-2 px-2 text-[9px] text-muted">
                <span className="w-20 flex-shrink-0" />
                <span className="w-4 flex-shrink-0" />
                <span className="min-w-0 flex-1" />
                <span className="w-14 flex-shrink-0 truncate text-right text-primary">
                  {profile.name}
                </span>
                <span className="w-4 flex-shrink-0" />
                <span className="w-14 flex-shrink-0 truncate text-right text-accent">
                  {oppProfile.name}
                </span>
              </div>
              <div className="space-y-1">
                {(showAllHistory ? h2h.records : h2h.records.slice(0, 10)).map((r, i) => (
                  <div
                    key={`${r.date}-${i}`}
                    className="flex items-center gap-2 rounded bg-surface p-2 text-xs"
                  >
                    <span className="w-20 flex-shrink-0 font-medium text-muted">
                      {formatDate(r.date)}
                    </span>
                    <span
                      className={`w-4 flex-shrink-0 rounded text-center text-[9px] font-bold leading-4 ${
                        r.discipline === "sprint"
                          ? "bg-blue-500/15 text-blue-400"
                          : "bg-green-500/15 text-green-400"
                      }`}
                    >
                      {r.discipline === "sprint" ? "S" : "F"}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{r.eventName}</span>
                    <span
                      className={`w-14 flex-shrink-0 text-right font-mono font-bold ${
                        r.result === "win" ? "text-primary" : "text-muted"
                      }`}
                    >
                      {r.myPoints.toLocaleString()}
                    </span>
                    <span className="w-4 flex-shrink-0 text-center text-[9px] text-muted/60">
                      {r.result === "draw" ? "＝" : "vs"}
                    </span>
                    <span
                      className={`w-14 flex-shrink-0 text-right font-mono font-bold ${
                        r.result === "loss" ? "text-accent" : "text-muted"
                      }`}
                    >
                      {r.oppPoints.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
              {h2h.records.length > 10 && (
                <button
                  onClick={() => setShowAllHistory((v) => !v)}
                  className="mt-1 flex w-full items-center justify-center gap-1 rounded-md border border-border bg-surface px-3 py-1.5 text-[10px] font-medium text-muted transition-colors hover:border-primary/30 hover:bg-card-hover hover:text-foreground"
                >
                  {showAllHistory ? "閉じる" : `全 ${h2h.records.length} 戦を表示`}
                  <ChevronDown
                    className={`h-3 w-3 transition-transform ${showAllHistory ? "rotate-180" : ""}`}
                  />
                </button>
              )}
            </div>
          )}

          {/* 再戦予定 */}
          {rematches.length > 0 && (
            <div className="mt-3 border-t border-border pt-3">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
                再戦予定
              </p>
              <div className="space-y-1.5">
                {rematches.map((m) => (
                  <a
                    key={m.joeEventId}
                    href={m.joeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 rounded bg-surface p-2 transition-colors hover:bg-white/5"
                  >
                    <span className="w-20 flex-shrink-0 text-xs font-medium text-muted">
                      {formatDate(m.date)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs">{m.eventName}</span>
                    {m.sameClass && m.classNames.length > 0 && (
                      <span className="flex-shrink-0 rounded bg-white/5 px-1.5 py-0.5 text-[10px] font-bold text-muted">
                        {m.classNames.join(" / ")}
                      </span>
                    )}
                    <span
                      className={`flex-shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold leading-none ${
                        m.sameClass
                          ? "bg-primary/15 text-primary"
                          : "bg-white/5 text-muted"
                      }`}
                    >
                      {m.sameClass ? "同クラスで再戦" : "同大会出場予定"}
                    </span>
                    <ExternalLink className="h-3 w-3 flex-shrink-0 text-muted/50" />
                  </a>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
