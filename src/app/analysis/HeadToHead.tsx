"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { Swords, Search, X, Loader2, ExternalLink, ChevronDown } from "lucide-react";
import type {
  AthleteIndex,
  AthleteSummary,
  AthleteProfile,
  EventScore,
  RankingAppearance,
} from "@/lib/analysis/types";
import type { AthleteEntryRef } from "@/lib/entries/index-types";
import { loadAthleteDetail } from "@/lib/analysis/utils";
import { stripEventNoise, eventFuzzyMatch } from "@/lib/analysis/event-match";

interface Props {
  /** 自分（AthleteDetail がロード済みのプロフィール） */
  profile: AthleteProfile;
  athleteIndex: AthleteIndex;
  /** 自分の出場予定エントリー（AthleteDetail がロード済み。null = 取得失敗） */
  myEntries: AthleteEntryRef[] | null;
}

/** 1対戦レコード（大会単位に重複排除済み） */
interface H2HRecord {
  date: string;
  eventName: string;
  myPoints: number;
  oppPoints: number;
  discipline: "forest" | "sprint";
  result: "win" | "loss" | "draw";
}

interface Tally {
  win: number;
  loss: number;
  draw: number;
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

/**
 * 同姓同名の合成エントリ判定: athlete-index は空白除去名キーのため、同姓同名の別人が
 * 1エントリに合成され同一 (type, className) の appearance が複数並ぶ。
 * loadAthleteDetail が先勝ちで拾うと別人の成績が混ざった対戦成績になるため候補チップから除外する。
 */
function hasMergedNamesakes(a: AthleteSummary): boolean {
  const seen = new Set<string>();
  for (const r of a.appearances) {
    const k = `${r.type}__${r.className}`;
    if (seen.has(k)) return true;
    seen.add(k);
  }
  return false;
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

  // 相手データの結果キャッシュ（77シャードの遅延 fetch を選手切替のたびに繰り返さない）
  const profileCache = useRef(new Map<string, AthleteProfile>());
  const entriesCache = useRef(new Map<string, AthleteEntryRef[]>());

  // 相手の選択/解除（effect 内の同期 setState を避けるためハンドラ側でリセット）
  const selectOpponent = (a: AthleteSummary | null) => {
    setOpponent(a);
    setOppProfile(null);
    setOppEntries(null);
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
    return () => {
      cancelled = true;
    };
  }, [opponent]);

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

  // デフォルト候補チップ: 「成績が近い選手」を同クラブ・他クラブ両方から提示する。
  // 近さ = 自分と共通の (type, className) ランキングでの順位差（最小）。bestRank（カテゴリ横断の
  // 最小順位＝クラブの強者に寄る）ではなく、共通クラスでの近順位で“同レベルのライバル”を選ぶ。
  // 同クラブはプロフィールの全クラブを対象（複数兼部も全部）。
  const candidates = useMemo(() => {
    const myClubs = new Set(profile.clubs);
    const myRankByPair = new Map<string, number>();
    for (const r of profile.appearances) myRankByPair.set(`${r.type}__${r.className}`, r.rank);

    type Scored = {
      athlete: AthleteSummary;
      className: string;
      rank: number;
      diff: number;
      sameClub: boolean;
    };
    const scored: Scored[] = [];
    for (const a of Object.values(athleteIndex.athletes)) {
      if (a.name === profile.name || hasMergedNamesakes(a)) continue;
      // 共通クラスのうち最も順位が近いものを採用（無ければ候補外）
      let best: { className: string; rank: number; diff: number } | null = null;
      for (const app of a.appearances) {
        const myRank = myRankByPair.get(`${app.type}__${app.className}`);
        if (myRank == null) continue;
        const diff = Math.abs(app.rank - myRank);
        if (!best || diff < best.diff) best = { className: app.className, rank: app.rank, diff };
      }
      if (!best) continue;
      scored.push({ athlete: a, ...best, sameClub: a.clubs.some((c) => myClubs.has(c)) });
    }
    // 近い順（同差なら順位昇順→名前で決定的に）
    scored.sort(
      (x, y) => x.diff - y.diff || x.rank - y.rank || x.athlete.name.localeCompare(y.athlete.name)
    );

    // 同クラブの近成績を先に最大4、残りを他クラブの近成績で埋めて最大8（片方が少なければ補充）
    const MAX = 8;
    const SAME_CLUB_QUOTA = 4;
    const sameClubList = scored.filter((s) => s.sameClub);
    const otherClubList = scored.filter((s) => !s.sameClub);
    const picked: Scored[] = [];
    const seen = new Set<string>([profile.name]);
    const take = (arr: Scored[], n: number) => {
      for (const s of arr) {
        if (picked.length >= MAX || n <= 0) break;
        if (seen.has(s.athlete.name)) continue;
        seen.add(s.athlete.name);
        picked.push(s);
        n--;
      }
    };
    take(sameClubList, SAME_CLUB_QUOTA);
    take(otherClubList, MAX - picked.length);
    take(sameClubList, MAX - picked.length); // 他クラブが少なければ同クラブで補充

    return picked.map((s) => ({
      athlete: s.athlete,
      label: `${s.sameClub ? "同クラブ・" : ""}${s.className} ${s.rank}位`,
    }));
  }, [profile, athleteIndex]);

  // 突合: 共通 (type, className) ペアの event_scores を date＋イベント名で突合 →
  // date＋正規化イベント名で大会単位に重複排除（無差別系と個別クラスで同一レースが重複するため。
  // points はクラス間で同値なので勝敗は不変）
  const h2h = useMemo(() => {
    if (!oppProfile) return null;
    const oppByPair = new Map<string, RankingAppearance>();
    for (const r of oppProfile.rankings) oppByPair.set(`${r.type}__${r.className}`, r);

    const records = new Map<string, H2HRecord>();
    for (const myR of profile.rankings) {
      const oppR = oppByPair.get(`${myR.type}__${myR.className}`);
      if (!oppR) continue;
      const discipline: "forest" | "sprint" = myR.type.includes("sprint") ? "sprint" : "forest";

      const oppByDate = new Map<string, EventScore[]>();
      for (const e of oppR.events) {
        if (!e.date) continue;
        const arr = oppByDate.get(e.date);
        if (arr) arr.push(e);
        else oppByDate.set(e.date, [e]);
      }

      for (const myE of myR.events) {
        if (!myE.date) continue;
        const myNorm = stripEventNoise(myE.eventName);
        const key = `${myE.date}:${myNorm}`;
        if (records.has(key)) continue;
        const sameDay = oppByDate.get(myE.date);
        if (!sameDay) continue;
        const oppE =
          sameDay.find((c) => stripEventNoise(c.eventName) === myNorm) ??
          sameDay.find((c) => eventFuzzyMatch(c.eventName, myE.eventName));
        if (!oppE) continue;
        const result: H2HRecord["result"] =
          myE.points > oppE.points ? "win" : myE.points < oppE.points ? "loss" : "draw";
        records.set(key, {
          date: myE.date,
          eventName: myE.eventName,
          myPoints: myE.points,
          oppPoints: oppE.points,
          discipline,
          result,
        });
      }
    }

    const list = [...records.values()].sort((a, b) => b.date.localeCompare(a.date));
    const total: Tally = { win: 0, loss: 0, draw: 0 };
    const forest: Tally = { win: 0, loss: 0, draw: 0 };
    const sprint: Tally = { win: 0, loss: 0, draw: 0 };
    for (const r of list) {
      total[r.result]++;
      (r.discipline === "sprint" ? sprint : forest)[r.result]++;
    }
    return { records: list, total, forest, sprint };
  }, [profile, oppProfile]);

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
              <div className="mt-2 flex justify-center gap-4 text-[10px]">
                {h2h.forest.win + h2h.forest.loss + h2h.forest.draw > 0 && (
                  <span className="text-green-400">Forest {tallyText(h2h.forest)}</span>
                )}
                {h2h.sprint.win + h2h.sprint.loss + h2h.sprint.draw > 0 && (
                  <span className="text-blue-400">Sprint {tallyText(h2h.sprint)}</span>
                )}
              </div>
            )}
          </div>

          <p className="mt-2 text-[9px] text-muted/70">
            ※ JOY ランキング換算点での比較です（同一大会でも別クラス出走の場合があります）
          </p>

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
                  className="mt-1 flex w-full items-center justify-center gap-1 rounded px-2 py-1 text-[10px] text-muted/70 transition-colors hover:text-muted"
                >
                  {showAllHistory ? "閉じる" : `全 ${h2h.records.length} 戦を表示`}
                  <ChevronDown
                    className={`h-2.5 w-2.5 transition-transform ${showAllHistory ? "rotate-180" : ""}`}
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
