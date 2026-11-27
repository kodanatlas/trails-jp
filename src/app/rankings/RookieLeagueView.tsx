"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Loader2, Search } from "lucide-react";
import Link from "@/components/AppLink";
import type { Affiliation, RookieLeagueData, RookieEntry } from "@/lib/rookie/types";

const AFFILIATIONS: (Affiliation | "すべて")[] = ["すべて", "大学", "中高", "一般"];

function RookieRow({ entry, rankInView, open, onToggle }: { entry: RookieEntry; rankInView: number; open: boolean; onToggle: () => void }) {
  return (
    <div className="border-b border-border/60">
      <button onClick={onToggle} className="flex w-full items-center gap-3 px-2 py-2.5 text-left hover:bg-white/[0.02]">
        <span className="w-7 flex-shrink-0 text-right font-mono text-lg font-bold tabular-nums text-muted">{rankInView}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">
            {entry.linkable ? (
              <Link href={`/a/${encodeURIComponent(entry.nameKey)}`} className="hover:text-primary" onClick={(e) => e.stopPropagation()}>
                {entry.name}
              </Link>
            ) : (
              entry.name
            )}
          </span>
          <span className="block truncate text-xs text-muted">{entry.club || "—"}</span>
        </span>
        <span className="hidden flex-shrink-0 text-xs text-muted sm:inline">
          <span className="whitespace-nowrap">{entry.affiliation}</span>
          <span className="mx-1.5">·</span>
          <span className="whitespace-nowrap">{entry.year}年目</span>
        </span>
        <span className="w-10 flex-shrink-0 text-right text-xs tabular-nums text-muted">B{entry.bRaces}</span>
        <span className="w-14 flex-shrink-0 text-right font-mono text-sm font-bold tabular-nums text-primary">{entry.score.toFixed(1)}</span>
        {open ? <ChevronUp className="h-4 w-4 flex-shrink-0 text-muted" /> : <ChevronDown className="h-4 w-4 flex-shrink-0 text-muted" />}
      </button>
      {open && (
        <div className="px-12 pb-3 text-xs text-muted">
          <p className="mb-1 sm:hidden">
            {entry.affiliation} · {entry.year}年目{entry.source === "未登録" ? " · 競技者登録なし" : ""}
          </p>
          <ul className="space-y-1">
            {entry.best.map((b) => (
              <li key={`${b.date}-${b.eventName}-${b.className}`} className="flex flex-wrap gap-x-3">
                <span className="tabular-nums">{b.date}</span>
                <span className="text-foreground">{b.eventName}</span>
                <span className="whitespace-nowrap">
                  {b.className}（{b.field}人）
                </span>
                <span className="whitespace-nowrap tabular-nums">上位3人平均との比 {b.ratio.toFixed(2)}</span>
                <span className="whitespace-nowrap tabular-nums">{b.points.toFixed(1)} 点</span>
              </li>
            ))}
            {entry.best.length < 2 && <li>2 戦目なし（0 点として平均）</li>}
          </ul>
          {entry.graduated && <p className="mt-1">A クラスで上位に入ったため、その日から後の B は数えていません。</p>}
        </div>
      )}
    </div>
  );
}

export function RookieLeagueView() {
  const [data, setData] = useState<RookieLeagueData | null>(null);
  const [failed, setFailed] = useState(false);
  const [fy, setFy] = useState<number | null>(null);
  const [aff, setAff] = useState<Affiliation | "すべて">("すべて");
  const [query, setQuery] = useState("");
  const [openKey, setOpenKey] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/data/rookie-league.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: RookieLeagueData) => {
        if (!alive) return;
        setData(d);
        setFy(d.seasons[0]?.fy ?? null);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  const season = data?.seasons.find((s) => s.fy === fy);
  const rows = useMemo(() => {
    const all = season?.entries ?? [];
    const byAff = aff === "すべて" ? all : all.filter((e) => e.affiliation === aff);
    const q = query.trim().toLowerCase();
    return q ? byAff.filter((e) => e.name.toLowerCase().includes(q) || e.club.toLowerCase().includes(q)) : byAff;
  }, [season, aff, query]);
  const rankInAff = useMemo(() => {
    const all = season?.entries ?? [];
    const list = aff === "すべて" ? all : all.filter((e) => e.affiliation === aff);
    return new Map(list.map((e, i) => [e.nameKey, i + 1]));
  }, [season, aff]);

  if (failed) return <p className="py-12 text-center text-sm text-muted">ルーキーリーグを読み込めませんでした。</p>;
  if (!data || !season) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        <span className="ml-2 text-sm text-muted">読み込み中...</span>
      </div>
    );
  }

  return (
    <div>
      <p className="mb-4 text-sm leading-relaxed text-muted">
        競技を始めて 2 年目までの選手が、B クラスの成績で競うランキングです。大学・中高・一般（社会人）をまとめて並べます。
      </p>

      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {data.seasons.map((s) => (
          <button
            key={s.fy}
            onClick={() => {
              setFy(s.fy);
              setOpenKey(null);
            }}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium ${fy === s.fy ? "border border-primary bg-primary text-white" : "border border-border text-muted hover:text-foreground"}`}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {AFFILIATIONS.map((a) => (
          <button
            key={a}
            onClick={() => setAff(a)}
            className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium ${aff === a ? "border border-primary bg-primary text-white" : "border border-border text-muted hover:text-foreground"}`}
          >
            {a}
          </button>
        ))}
      </div>

      <div className="relative mb-3">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
        <input
          type="text"
          placeholder="選手名・所属で検索..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded-lg border border-border bg-surface py-1.5 pl-8 pr-3 text-sm outline-none focus:border-primary"
        />
      </div>

      <p className="mb-2 text-xs text-muted">
        {season.from} 〜 {season.to} ・ {rows.length} 人 ・ 更新 {data.generatedAtJst} JST
      </p>

      <div className="flex items-center gap-3 border-b-2 border-primary/40 px-2 pb-2 text-[10px] font-medium uppercase tracking-wider text-muted">
        <span className="w-7 text-right">#</span>
        <span className="min-w-0 flex-1">選手 / 所属</span>
        <span className="hidden sm:inline">区分 · 年目</span>
        <span className="w-10 text-right">出走</span>
        <span className="w-14 text-right">点</span>
        <span className="w-4" />
      </div>
      {rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">該当する選手がいません。</p>
      ) : (
        rows.map((e) => (
          <RookieRow
            key={e.nameKey}
            entry={e}
            rankInView={rankInAff.get(e.nameKey) ?? e.rank}
            open={openKey === e.nameKey}
            onToggle={() => setOpenKey(openKey === e.nameKey ? null : e.nameKey)}
          />
        ))
      )}

      <details className="mt-6 rounded-lg border border-border p-4 text-xs leading-relaxed text-muted">
        <summary className="cursor-pointer text-sm font-medium text-foreground">点数と対象の決め方</summary>
        <ul className="mt-3 list-disc space-y-1.5 pl-5">
          <li>
            対象: JOA 競技者登録の初登録から 2 年度目まで。登録していない人は、LapCenter の結果に初めて出た年度から数えます。1〜3 月に始めた人は、翌年度を 1 年目とします。
          </li>
          <li>
            1 大会の点: そのクラスの上位 3 人の平均タイム ÷ 自分のタイム（上限 1.05）に、人数の補正 n/(n+2) を掛けます。4 人未満のクラスは使いません。
          </li>
          <li>順位: 上位 2 戦の平均です（1 戦だけの人は、もう 1 戦を 0 点として平均します）。表示は ×1000。</li>
          <li>A クラス（21A・ME など、20 人以上）で上位 3 人の平均の 0.85 倍以上の速さを出した人は、その日から後の B は数えません。</li>
          <li>
            新人かどうかは、公開の登録者名簿と LapCenter の結果からの推定です。以前から活動している方が載っている、掲載をやめたい、などは
            <Link href="/contact" className="text-primary hover:underline">
              お問い合わせ
            </Link>
            からご連絡ください。
          </li>
        </ul>
      </details>
    </div>
  );
}
