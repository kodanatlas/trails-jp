import type { Metadata } from "next";
import Link from "next/link";
import { readOringen } from "@/lib/oringen-store";
import {
  countConfirmedStarts,
  countDrawnEntries,
  countEntries,
  EVENT_TIME_ZONE,
} from "@/lib/oringen/normalize";
import { nextSyncAt } from "@/lib/oringen/schedule";
import { attachAthleteLinks } from "@/lib/oringen/athlete-link";
import programJson from "@/data/oringen-program.json";
import athleteIndexJson from "../../../../public/data/athlete-index.json";
import { AbroadTable } from "./AbroadTable";

/**
 * 選手ページ `/a/[key]` の存在確認用。**サーバー側でだけ触る**
 * （athlete-index.json は 1.9MB。クライアントバンドルに入れてはいけない）。
 */
const ATHLETE_INDEX_KEYS = new Set(
  Object.keys((athleteIndexJson as unknown as { athletes: Record<string, unknown> }).athletes),
);

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
  const stored = await readOringen();
  // 選手ページが実在する人にだけリンクを張る（張れない人が居るのは正常。athlete-link.ts 参照）
  const data = { ...stored, people: attachAthleteLinks(stored.people, ATHLETE_INDEX_KEYS) };
  const entries = countEntries(data.people);
  const confirmed = countConfirmedStarts(data.people);
  // 分母は「抽選クラス」だけ。全エントリーを分母にすると、フリースタート（＝永久に埋まらない）を
  // 「未確定・待てば埋まる」と誤読させる。2026-07-15 に実際にそう表示していた。
  const drawn = countDrawnEntries(data.people);
  const freeStart = entries - drawn;
  const clubs = new Set(data.people.map((p) => p.club)).size;
  const hasMtbo = data.people.some((p) =>
    Object.values(p.entries).flat().some((e) => e.className.startsWith("MTBO")),
  );
  // 色クラス（Blå/Gul/Orange/Svart …）に出る人がいるときだけ難易度の凡例を出す
  const usesColorClass = data.people.some((p) =>
    Object.values(p.entries)
      .flat()
      .some((e) => /(Vit|Gul|Orange|Lila|Blå|Svart)/.test(e.className)),
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
          抽選クラス {confirmed}/{drawn} 確定
        </span>
        {freeStart > 0 && <span>フリースタート {freeStart}</span>}
        {/* いつ時点のデータか。更新が止まったことを利用者が検知する唯一の手段 */}
        <span>更新 {toJst(data.generatedAt)} JST</span>
        {/*
          次回は「予定」。GitHub Actions の schedule は高負荷時に遅延・drop されうるので確約しない。
          ページ自体も ISR 10分なので、この表示は最大10分ずれる。だから「頃」。
        */}
        <span>次回 {toJstTime(nextSyncAt(new Date()))} 頃</span>
      </div>

      {freeStart > 0 && (
        <div className="mb-4 border-l-2 border-accent bg-card px-3 py-2">
          <p className="text-xs text-muted">
            表の空欄（—）は <strong className="text-foreground">フリースタート</strong>です。
            <strong className="text-foreground">待っても時刻は入りません。</strong>
            当日スタート地点に行って自分でスタート分を選ぶ方式で、そもそも時刻が割り当てられません
            （公式:「Du har fri starttid och väljer startminut när du kommer fram till din start」）。
            対象は <strong className="text-foreground">Kort（成人）・Motion・Etappstart・開放クラス（色）・DH75以上・PreO</strong>。
            スタートできる時間帯は{" "}
            {programJson.startWindows.map((w) => `${w.discipline} ${w.window}`).join(" / ")} です。
          </p>
          <p className="mt-1 text-xs text-muted">
            抽選クラスのスタート時刻は公開済みです（OL 7/7・MTBO 7/13）。
            <strong className="text-foreground"> 5日目の「チェイシング」</strong>は別で、
            4日目までの累計順位から決まるため、それまで未定です（DH10〜DH12 を除く全クラスが対象。
            Kort は1〜4日目がフリー、5日目だけチェイシング）。
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

      {/*
        表に Blå / Gul / Orange / Svart というクラス名が並ぶが、スウェーデン語の色が何を意味するか
        日本の読み手には分からない。11名が色クラスに出場している。
      */}
      {usesColorClass && (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-bold">クラス名の色＝難易度</h2>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-border text-left text-muted">
                  <th className="whitespace-nowrap px-2 py-1.5 font-medium">色</th>
                  <th className="whitespace-nowrap px-2 py-1.5 font-medium">難易度</th>
                  <th className="px-2 py-1.5 font-medium">内容</th>
                </tr>
              </thead>
              <tbody>
                {programJson.difficultyLevels.map((d) => (
                  <tr key={d.sv} className="border-b border-border/50">
                    <td className="whitespace-nowrap px-2 py-1.5">
                      <span className="flex items-center gap-1.5">
                        {/*
                          色の凡例なので実際の色を出す。白(#FFFFFF)と黒(#1A1A1A)は
                          ライト/ダークどちらかの背景に溶けるため、常に枠線を付ける。
                        */}
                        <span
                          aria-hidden="true"
                          className="inline-block h-3 w-3 shrink-0 rounded-sm border border-border"
                          style={{ backgroundColor: d.hex }}
                        />
                        <span>
                          {d.sv}
                          <span className="ml-1 text-muted">{d.ja}</span>
                        </span>
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-muted">{d.level}</td>
                    <td className="px-2 py-1.5 text-muted">{d.desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[10px] text-muted">
            数字はコース長（km）。例: <span className="font-mono">Etappstart Svart 7,5</span> = 1日エントリーの黒（難）7.5km。
          </p>
        </section>
      )}

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-bold">公式サイトの関連ページ</h2>
        <ul className="flex flex-col gap-1 text-xs">
          {[
            { href: programJson.officialUrls.pm, label: "PM（競技注意事項）", note: "各ステージの詳細。スタート地点名・地図の注意など。暫定版のため直前まで更新される" },
            { href: programJson.officialUrls.classes, label: "クラス制度（OL）", note: "抽選スタート／フリースタートの規定" },
            { href: programJson.officialUrls.travel, label: "会場への行き方（Resa）", note: "各エタップへの交通" },
            { href: programJson.officialUrls.news, label: "ニュース", note: "スタート時刻の公開・キャンプ・訓練用地図など直前情報" },
            { href: programJson.officialUrls.areas, label: "競技地域（Tävlingsområden）", note: "会場と地形の解説" },
          ].map((l) => (
            <li key={l.href}>
              <a href={l.href} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                {l.label}
              </a>
              <span className="ml-2 text-[10px] text-muted">{l.note}</span>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted">
          <span>PM の各日:</span>
          {programJson.officialUrls.pmStages.map((u, i) => (
            <a key={u} href={u} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
              {i + 1}日目
            </a>
          ))}
          <span>（スウェーデン語）</span>
        </div>
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
