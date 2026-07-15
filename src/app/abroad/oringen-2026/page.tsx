import type { Metadata } from "next";
import Link from "next/link";
import { readOringen } from "@/lib/oringen-store";
import { countConfirmedStarts, countEntries, EVENT_TIME_ZONE } from "@/lib/oringen/normalize";
import { nextSyncAt } from "@/lib/oringen/schedule";
import programJson from "@/data/oringen-program.json";
import { AbroadTable } from "./AbroadTable";

/**
 * O-Ringen Göteborg 2026 の日本勢情報。**期間限定**。
 *
 * 撤去手順は docs/plans/2026-07-15_abroad_oringen.md の「掲載終了」節。
 */

export const metadata: Metadata = {
  title: "O-Ringen Göteborg 2026",
  description: "O-Ringen Göteborg 2026 に出場する日本勢のスタートリストと日程（trails.jp）。",
  robots: { index: false, follow: false },
};

// GitHub Actions が開催期間中1日2回更新する → 10分 ISR
export const revalidate = 600;

/** ISO8601 → "M/D H:mm"（JST） */
function toJst(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "不明";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

/** Date → "H:mm"（JST） */
function toJstTime(d: Date): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

const WEEKDAY = ["日", "月", "火", "水", "木", "金", "土"];

function formatRaceDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${WEEKDAY[d.getUTCDay()]}）`;
}

/** その日の会場（徒歩競技）。プログラムは静的データ。 */
function footVenue(stage: number) {
  return programJson.venues.foot.find((v) => v.stages.includes(stage));
}

export default async function OringenPage() {
  const data = await readOringen();
  const entries = countEntries(data.people);
  const confirmed = countConfirmedStarts(data.people);
  const clubs = new Set(data.people.map((p) => p.club)).size;
  const hasMtbo = data.people.some((p) =>
    Object.values(p.entries).flat().some((e) => e.className.startsWith("MTBO")),
  );

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <nav className="mb-3 text-[10px] text-muted">
        <Link href="/abroad" className="hover:text-foreground">
          海外遠征
        </Link>
        <span className="mx-1">/</span>
        <span>O-Ringen 2026</span>
      </nav>

      <div className="mb-1 flex items-center gap-2">
        <h1 className="text-2xl font-bold">{data.eventName} 2026</h1>
      </div>
      <p className="mb-4 text-xs text-muted">
        {data.races[0]?.date} 〜 {data.races[data.races.length - 1]?.date} / スウェーデン・イェーテボリ。
        出場する日本勢 {data.people.length} 名 / {clubs} クラブを、所属クラブの国コード（JPN）で抽出しています。
        <strong className="text-foreground"> 時刻はすべてスウェーデン現地時間</strong>（{EVENT_TIME_ZONE}）です。
      </p>

      <div className="mb-4 flex flex-wrap gap-x-4 gap-y-1 border-y border-border py-2 font-mono text-[10px] text-muted">
        <span>{data.people.length} 名</span>
        <span>{clubs} クラブ</span>
        <span>延べ {entries} エントリー</span>
        <span>
          スタート時刻 確定 {confirmed}/{entries}
        </span>
        {/* いつ時点のデータか。更新が止まったことを利用者が検知する唯一の手段 */}
        <span>更新 {toJst(data.generatedAt)} JST</span>
        {/*
          次回は「予定」。GitHub Actions の schedule は高負荷時に遅延・drop されうるので確約しない。
          ページ自体も ISR 10分なので、この表示は最大10分ずれる。だから「頃」。
        */}
        <span>次回 {toJstTime(nextSyncAt(new Date()))} 頃</span>
      </div>

      {confirmed < entries && (
        <div className="mb-4 border-l-2 border-accent bg-card px-3 py-2">
          <p className="text-xs text-muted">
            スタート時刻は{" "}
            <strong className="text-foreground">
              {confirmed}/{entries}
            </strong>{" "}
            件のみ確定しています。残りは空欄（—）です。これは取得漏れではなく{" "}
            <strong className="text-foreground">O-Ringen 側が未抽選</strong>のためで、開催が近づくと埋まります
            （2025年大会では最終的に全クラスが確定していました）。
          </p>
        </div>
      )}

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-bold">日程・会場</h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-border text-left text-muted">
                <th className="whitespace-nowrap px-2 py-1.5 font-medium">ステージ</th>
                <th className="whitespace-nowrap px-2 py-1.5 font-medium">日付</th>
                <th className="whitespace-nowrap px-2 py-1.5 font-medium">会場</th>
                <th className="whitespace-nowrap px-2 py-1.5 font-medium">種目</th>
                <th className="whitespace-nowrap px-2 py-1.5 font-medium">日本勢</th>
              </tr>
            </thead>
            <tbody>
              {data.races.map((r) => {
                const n = data.people.filter((p) => (p.entries[String(r.n)] ?? []).length > 0).length;
                const v = footVenue(r.n);
                return (
                  <tr key={r.n} className="border-b border-border/50">
                    <td className="whitespace-nowrap px-2 py-1.5">{r.n}日目</td>
                    <td className="whitespace-nowrap px-2 py-1.5 font-mono tabular-nums">
                      {formatRaceDate(r.date)}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5">
                      {v ? (
                        <span>
                          {v.name}
                          <span className="block text-[10px] text-muted">{v.area}</span>
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-muted">{v?.format ?? "—"}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 font-mono tabular-nums text-muted">{n} 名</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex flex-col gap-1 text-[10px] leading-relaxed text-muted">
          <div>
            <span className="text-foreground">スタート窓</span>:{" "}
            {programJson.startWindows.map((w) => `${w.discipline} ${w.window}`).join(" / ")}
          </div>
          <div>
            <span className="text-foreground">開会式</span>: {programJson.opening.date}{" "}
            {programJson.opening.time} @ {programJson.opening.venue}（{programJson.opening.note}）
          </div>
          {programJson.notes.map((n) => (
            <div key={n}>{n}</div>
          ))}
          {hasMtbo && (
            <div>
              MTBO の会場は徒歩競技と異なります:{" "}
              {programJson.venues.mtbo.map((v) => `E${v.stages.join("・")} ${v.name}`).join(" / ")}
            </div>
          )}
          <div className="pt-1">
            会場・日程は{" "}
            <span className="text-foreground">{programJson.extractedAt} 時点</span>で公式サイトから取得したものです。
            開催が近づくと更新されることがあるため、最新は{" "}
            <a
              href={programJson.officialUrls.pm}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              公式 PM
            </a>{" "}
            /{" "}
            <a
              href={programJson.officialUrls.areas}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              競技地域
            </a>{" "}
            で確認してください。
          </div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-bold">日本人スタートリスト</h2>
        <AbroadTable data={data} />
      </section>

      <div className="border-t border-border pt-3 text-[10px] leading-relaxed text-muted">
        <p>
          スタートリストの出典:{" "}
          <a href={data.resultUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
            O-Ringen 公式結果システム
          </a>
          {" "}の JSON API（公開ページの転記ではありません）。
          {data.links.eventor && (
            <>
              {" / "}
              <a
                href={data.links.eventor}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                Eventor
              </a>
            </>
          )}
          {" / "}
          <a
            href={programJson.officialUrls.overview}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            oringen.se（公式）
          </a>
        </p>
        <p className="mt-1">
          漢字氏名は O-Ringen 側にデータが無いため、trails.jp の選手データと読み・クラブ・年齢クラスで
          照合したものです。点線は推定。特定できなかった選手はローマ字のみ表示しています。
        </p>
      </div>
    </div>
  );
}
