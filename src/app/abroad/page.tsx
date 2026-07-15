import type { Metadata } from "next";
import { readOringen } from "@/lib/oringen-store";
import { countConfirmedStarts, countEntries, EVENT_TIME_ZONE } from "@/lib/oringen/normalize";
import { AbroadTable } from "./AbroadTable";

/**
 * 海外遠征 — O-Ringen Göteborg 2026 の日本勢情報。**期間限定**。
 *
 * 掲載終了の手順は docs/plans/2026-07-15_abroad_oringen.md の「掲載終了」節:
 *   1. Header.tsx の navItems から /abroad の行を削除
 *   2. このディレクトリを src/app/_abroad にリネーム（_ prefix でルーティング除外）
 *   3. .github/workflows/sync-oringen.yml の schedule をコメントアウト
 */

export const metadata: Metadata = {
  title: "海外遠征",
  description: "O-Ringen Göteborg 2026 に出場する日本勢のスタートリストと日程（trails.jp）。",
  // 実名・所属が並ぶ期間限定ページ。検索エンジンには載せない。
  robots: { index: false, follow: false },
};

// GitHub Actions が開催期間中1日2回更新する → 10分 ISR
export const revalidate = 600;

/** ISO8601 → "M/D H:mm JST" */
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

const WEEKDAY = ["日", "月", "火", "水", "木", "金", "土"];

function formatRaceDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${WEEKDAY[d.getUTCDay()]}）`;
}

export default async function AbroadPage() {
  const data = await readOringen();
  const entries = countEntries(data.people);
  const confirmed = countConfirmedStarts(data.people);
  const clubs = new Set(data.people.map((p) => p.club)).size;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <div className="mb-1 flex items-center gap-2">
        <h1 className="text-2xl font-bold">海外遠征</h1>
        <span className="rounded bg-accent/20 px-2 py-0.5 text-[10px] font-medium text-[#00e5ff]">
          O-Ringen 2026
        </span>
      </div>
      <p className="mb-4 text-xs text-muted">
        {data.eventName}（{data.races[0]?.date} 〜 {data.races[data.races.length - 1]?.date}）に出場する日本勢
        {data.people.length} 名 / {clubs} クラブ。所属クラブの国コード（JPN）で抽出しています。
        <strong className="text-foreground"> 時刻はすべてスウェーデン現地時間</strong>（{EVENT_TIME_ZONE}）です。
      </p>

      <div className="mb-4 flex flex-wrap gap-x-4 gap-y-1 border-y border-border py-2 font-mono text-[10px] text-muted">
        <span>{data.people.length} 名</span>
        <span>{clubs} クラブ</span>
        <span>延べ {entries} エントリー</span>
        <span>スタート時刻 確定 {confirmed}/{entries}</span>
        {/* いつ時点のデータか。更新が止まったことを利用者が検知する唯一の手段 */}
        <span>更新 {toJst(data.generatedAt)} JST</span>
      </div>

      {confirmed < entries && (
        <div className="mb-4 border-l-2 border-accent bg-card px-3 py-2">
          <p className="text-xs text-muted">
            スタート時刻は <strong className="text-foreground">{confirmed}/{entries}</strong> 件のみ確定しています。
            残りは空欄（—）です。これは取得漏れではなく <strong className="text-foreground">O-Ringen 側が未抽選</strong>のためで、
            開催が近づくと埋まります（2025年大会では最終的に全クラスが確定していました）。
          </p>
        </div>
      )}

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-bold">日程</h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-border text-left text-muted">
                <th className="whitespace-nowrap px-2 py-1.5 font-medium">ステージ</th>
                <th className="whitespace-nowrap px-2 py-1.5 font-medium">日付</th>
                <th className="whitespace-nowrap px-2 py-1.5 font-medium">日本勢</th>
              </tr>
            </thead>
            <tbody>
              {data.races.map((r) => {
                const n = data.people.filter((p) => (p.entries[String(r.n)] ?? []).length > 0).length;
                return (
                  <tr key={r.n} className="border-b border-border/50">
                    <td className="whitespace-nowrap px-2 py-1.5">{r.n}日目</td>
                    <td className="whitespace-nowrap px-2 py-1.5 font-mono tabular-nums">
                      {formatRaceDate(r.date)}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 font-mono tabular-nums text-muted">{n} 名</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[10px] text-muted">
          7/22 は休養日のため 3日目は 7/23 です。会場・プログラムの詳細は公式サイトを参照してください。
        </p>
      </section>

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-bold">日本人スタートリスト</h2>
        <AbroadTable data={data} />
      </section>

      <div className="border-t border-border pt-3 text-[10px] leading-relaxed text-muted">
        <p>
          出典:{" "}
          <a href={data.resultUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
            O-Ringen 公式結果システム
          </a>
          {" "}の JSON API（公開ページの転記ではありません）。
          {data.links.eventor && (
            <>
              {" / "}
              <a href={data.links.eventor} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                Eventor
              </a>
            </>
          )}
          {" / "}
          <a href={data.links.official} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
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
