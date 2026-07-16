"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { missingStartReason } from "@/lib/oringen/start-type";
import { difficultyOf, type DifficultyLevel } from "@/lib/oringen/difficulty";
import { clubDisplay, type ClubInfo } from "@/lib/oringen/club";
import { competitorPageUrl, officialCompetitorUrl } from "@/lib/oringen/official-link";
import programJson from "@/data/oringen-program.json";
import clubMapJson from "@/data/oringen-club-map.json";
import type { OringenData, OringenPerson } from "@/lib/oringen/types";

/**
 * 日本勢のスタートリスト表。「選手一覧」（1人=1行 × 5日）と日別（時刻順）を切り替える。
 *
 * 生年は持たない・出さない（types.ts のコメント参照）。同定はクラス＋クラブで足りる。
 *
 * 時刻が無いセルは「フリー」と明示する。ただの「—」だと**待てば埋まる**ように読めるが、
 * フリースタートのクラスは永久に埋まらない（2026-07-15 に実際そう表示していた誤りの修正）。
 */

const WEEKDAY = ["日", "月", "火", "水", "木", "金", "土"];

const LEVELS = programJson.difficultyLevels as DifficultyLevel[];
const CLUB_MAP = clubMapJson.clubs as Record<string, ClubInfo>;

/**
 * クラブ名。O-Ringen はローマ字しか持たないので日本語名を併記する。
 * `Siosio Japan` `OK22` は O-Ringen 用の臨時チームで日本の実在クラブではないため、
 * 日本語名を捏造せず「臨時チーム」と示す。
 */
function ClubName({ club }: { club: string }) {
  const d = clubDisplay(club, CLUB_MAP);
  return (
    <span className="block">
      <span>{club}</span>
      {d.ja && <span className="block text-[10px] text-foreground/70">{d.ja}</span>}
      {d.adhoc && (
        <span className="block text-[10px] text-muted" title={d.note ?? undefined}>
          臨時チーム
        </span>
      )}
    </span>
  );
}

/**
 * クラス名。開放クラス／Etappstart は**色名が難易度そのもの**（Grön=初心者 … Svart=難）なので
 * 色見本を添える。スウェーデン語の色名だけでは日本の読み手に難易度が伝わらない。
 * ページ下部の凡例と対応する。
 */
function ClassName({ name }: { name: string }) {
  const d = difficultyOf(name, LEVELS);
  if (!d) return <>{name}</>;
  return (
    <span className="inline-flex items-center gap-1">
      <span
        aria-hidden="true"
        className="inline-block h-2 w-2 shrink-0 rounded-full border border-border"
        style={{ backgroundColor: d.hex }}
      />
      <span title={`${d.sv} = ${d.ja}（${d.level}）`}>{name}</span>
    </span>
  );
}

function dayLabel(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${WEEKDAY[d.getUTCDay()]}）`;
}

/** 時刻の無いものは常に最後（Excel の空白セルと同じ）。確定分は時刻順。 */
function compareStart(a: string | null, b: string | null): number {
  if (a && b) return a.localeCompare(b);
  if (a) return -1;
  if (b) return 1;
  return 0;
}

/**
 * 氏名。リンクの行き先を2系統に分けている:
 * - 漢字 → trails.jp の選手ページ。**実在するときだけ**リンクにする（athlete-link.ts 参照。
 *   `athleteKey` はサーバー側で索引と突合して詰めてあるので、ここでは有無を見るだけ）
 * - ローマ字 → O-Ringen 公式の選手ページ（official-link.ts）。ローマ字は公式サイトの登録名
 *   そのものなので、公式への入口をここに置く。旧データで ID が無ければ素のテキストに戻る
 */
function NameCell({ person, officialUrl }: { person: OringenPerson; officialUrl: string | null }) {
  const romaji = officialUrl ? (
    <a
      href={officialUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="font-mono text-[10px] text-muted hover:text-primary hover:underline"
      title="O-Ringen 公式の選手ページ"
    >
      {person.name} <span aria-hidden="true">↗</span>
    </a>
  ) : (
    <span className="font-mono text-[10px] text-muted">{person.name}</span>
  );

  if (!person.kanji) {
    // 漢字未特定: ローマ字が主表記なので font-medium のまま公式リンクにする
    return officialUrl ? (
      <a
        href={officialUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium hover:text-primary hover:underline"
        title="O-Ringen 公式の選手ページ"
      >
        {person.name} <span aria-hidden="true" className="text-[10px] text-muted">↗</span>
      </a>
    ) : (
      <span className="font-medium">{person.name}</span>
    );
  }

  const kanji = (
    <span
      className={cn(
        "font-medium",
        // 推定は点線で区別する（読み・クラブからの人手照合であり確定ではない）
        person.kanjiConfidence === "medium" && "border-b border-dotted border-muted",
      )}
      title={person.kanjiConfidence === "medium" ? "trails.jp の選手データとの照合による推定" : undefined}
    >
      {person.kanji}
    </span>
  );

  return (
    <span className="block">
      {person.athleteKey ? (
        <Link
          href={`/a/${encodeURIComponent(person.athleteKey)}`}
          className="text-primary hover:underline"
          title={`${person.kanji} の選手ページ`}
        >
          {kanji}
        </Link>
      ) : (
        kanji
      )}
      {/* ローマ字は現地の掲示・呼出しで使われる正式表記なので必ず併記する */}
      <span className="block">{romaji}</span>
    </span>
  );
}

/**
 * スタート時刻。時刻が無い場合、**理由によって表示を分ける**。
 * 全部「—」にすると、永久に入らないもの（フリー）と入るもの（チェイシング）が区別できない。
 */
function StartTime({
  value,
  className,
  stage,
}: {
  value: string | null;
  className: string;
  stage: number;
}) {
  if (value) return <span className="font-mono tabular-nums">{value}</span>;

  const reason = missingStartReason(className, stage);
  if (reason === "free-start") {
    return (
      <span className="text-muted" title="当日スタート地点で自分でスタート分を選ぶ方式。時刻の割当なし">
        フリー
      </span>
    );
  }
  if (reason === "chase-start") {
    return (
      <span className="text-muted" title="チェイシングスタート。4日目までの累計順位から決まるため、それまで未定">
        チェイシング
      </span>
    );
  }
  return (
    <span className="text-muted" title="抽選クラスだが未公開">
      —
    </span>
  );
}

export function AbroadTable({ data }: { data: OringenData }) {
  const [tab, setTab] = useState<"all" | number>("all");
  const [q, setQ] = useState("");

  const people = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return data.people;
    return data.people.filter((p) => {
      const hay = [
        p.name,
        p.kanji ?? "",
        p.club,
        // 日本語のクラブ名でも引けるようにする（「入間市OLC」で検索して0件では意味がない）
        clubDisplay(p.club, CLUB_MAP).ja ?? "",
        ...Object.values(p.entries).flat().map((e) => e.className),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [data.people, q]);

  /** 日別ビュー用に (人 × その日のエントリー) へ展開して時刻順に並べる */
  const dayRows = useMemo(() => {
    if (tab === "all") return [];
    return people
      .flatMap((p) => (p.entries[String(tab)] ?? []).map((e) => ({ person: p, entry: e })))
      .sort(
        (a, b) =>
          compareStart(a.entry.startTime, b.entry.startTime) || a.person.name.localeCompare(b.person.name),
      );
  }, [people, tab]);

  const tabs: { id: "all" | number; label: string }[] = [
    { id: "all", label: "選手一覧" },
    ...data.races.map((r) => ({ id: r.n, label: `${r.n}日目 ${dayLabel(r.date)}` })),
  ];

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1 border-b border-border">
        {tabs.map((t) => (
          <button
            key={String(t.id)}
            type="button"
            onClick={() => setTab(t.id)}
            aria-selected={tab === t.id}
            role="tab"
            className={cn(
              "-mb-px border-b-2 px-3 py-1.5 text-xs font-medium transition-colors",
              tab === t.id
                ? "border-primary text-primary"
                : "border-transparent text-muted hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mb-3 flex items-center gap-2">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="名前・クラブ・クラスで絞り込む"
          aria-label="絞り込み"
          className="w-full max-w-xs rounded-md border border-border bg-card px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted"
        />
        <span className="whitespace-nowrap font-mono text-[10px] text-muted">
          {tab === "all" ? `${people.length} 名` : `${dayRows.length} エントリー`}
        </span>
      </div>

      {/* 横に広い表はこのコンテナ内でスクロールさせ、ページ本体は横スクロールさせない */}
      <div className="overflow-x-auto">
        {tab === "all" ? (
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-border text-left text-muted">
                <th className="whitespace-nowrap px-2 py-1.5 font-medium">氏名</th>
                <th className="whitespace-nowrap px-2 py-1.5 font-medium">クラブ</th>
                {data.races.map((r) => (
                  <th key={r.n} className="whitespace-nowrap px-2 py-1.5 font-medium">
                    {dayLabel(r.date)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.name} className="border-b border-border/50 align-top">
                  <td className="whitespace-nowrap px-2 py-1.5">
                    <NameCell person={p} officialUrl={officialCompetitorUrl(p, data.resultUrl)} />
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-muted">
                    <ClubName club={p.club} />
                  </td>
                  {data.races.map((r) => {
                    const entries = p.entries[String(r.n)] ?? [];
                    return (
                      <td key={r.n} className="whitespace-nowrap px-2 py-1.5">
                        {entries.length === 0 ? (
                          <span className="text-muted">—</span>
                        ) : (
                          entries.map((e) => (
                            <span key={e.className} className="block">
                              <StartTime value={e.startTime} className={e.className} stage={r.n} />
                              <span className="block font-mono text-[10px] text-muted">
                                <ClassName name={e.className} />
                              </span>
                            </span>
                          ))
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-border text-left text-muted">
                <th className="whitespace-nowrap px-2 py-1.5 font-medium">スタート</th>
                <th className="whitespace-nowrap px-2 py-1.5 font-medium">氏名</th>
                <th className="whitespace-nowrap px-2 py-1.5 font-medium">クラス</th>
                <th className="whitespace-nowrap px-2 py-1.5 font-medium">クラブ</th>
                <th className="whitespace-nowrap px-2 py-1.5 font-medium">距離</th>
              </tr>
            </thead>
            <tbody>
              {dayRows.map(({ person, entry }) => (
                <tr key={`${person.name}:${entry.className}`} className="border-b border-border/50 align-top">
                  <td className="whitespace-nowrap px-2 py-1.5">
                    <StartTime
                      value={entry.startTime}
                      className={entry.className}
                      stage={typeof tab === "number" ? tab : 0}
                    />
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5">
                    {/* 行＝その日の1エントリーなので、Etappstart（日別 ID）でもその日の公式ページへ直接飛べる */}
                    <NameCell
                      person={person}
                      officialUrl={
                        typeof entry.competitorId === "number"
                          ? competitorPageUrl(data.resultUrl, entry.competitorId)
                          : officialCompetitorUrl(person, data.resultUrl)
                      }
                    />
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-muted">
                    <ClassName name={entry.className} />
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-muted">
                    <ClubName club={person.club} />
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 font-mono tabular-nums text-muted">
                    {entry.distanceM ? `${(entry.distanceM / 1000).toFixed(2)} km` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {people.length === 0 && (
        <p className="py-8 text-center text-xs text-muted">該当する選手がいません。</p>
      )}
    </div>
  );
}
