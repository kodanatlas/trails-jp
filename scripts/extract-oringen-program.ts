/**
 * 公式サイト（oringen.se）から大会プログラムを **1回だけ** 抽出して
 * `src/data/oringen-program.json` に固める。
 *
 * **なぜ静的か**: 会場・スタート窓・開会式は大会前に確定していて、レース中に動かない。
 * 生きたスクレイパを常駐させると、変わらないデータのために壊れる経路を増やすだけ
 * （スウェーデン語 CMS で、大会中に壊れても気づきにくい）。
 *
 * **ただしプログラムは開催が近づくと更新されうる**（ユーザー指摘）。そこで:
 *   - 抽出日 `extractedAt` をページに出す（読み手が鮮度を判断できる）
 *   - ソースの本文ハッシュを持ち、`scripts/fetch-oringen.ts` が毎回照合して
 *     変化していれば警告する（＝再抽出のトリガー。誤った内容を表示する経路は増やさない）
 *
 * 使い方: npx tsx scripts/extract-oringen-program.ts
 *   → 出力を目視で確認してからコミットする（自動実行しない）
 */

import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const SOURCES = {
  oversikt: "https://oringen.se/tavling/oversikt.html",
  areas: "https://oringen.se/tavling/tavlingsomraden.html",
};

/** HTML から本文テキストだけ取り出す（ハッシュ比較の対象。タグ変更に過敏にならないようテキスト化する）。 */
export function toPlainText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 本文の該当セクションだけを切り出してハッシュ化する（ニュース等の無関係な変更で誤検知しないため）。 */
export function sectionHash(text: string, startMarker: string, endMarker: string): string {
  const s = text.indexOf(startMarker);
  const e = endMarker ? text.indexOf(endMarker, s) : -1;
  const body = s < 0 ? text : text.slice(s, e > s ? e : undefined);
  return createHash("sha256").update(body).digest("hex").slice(0, 16);
}

async function getText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return toPlainText(await res.text());
}

async function main() {
  const oversikt = await getText(SOURCES.oversikt);
  const areas = await getText(SOURCES.areas);

  // 抽出した事実は下に手で書き起こす（スウェーデン語の自動翻訳はしない。誤訳より人の確認を優先）。
  // ハッシュだけ自動で取り、次回以降の変更検知に使う。
  const program = {
    extractedAt: new Date().toISOString().slice(0, 10),
    sources: [
      {
        url: SOURCES.oversikt,
        hash: sectionHash(oversikt, "Översikt O-Ringen Göteborg", "Precisionsorientering, PreO"),
      },
      {
        url: SOURCES.areas,
        hash: sectionHash(areas, "Orienteringslöpning, OL", "Precisionsorientering, PreO"),
      },
    ],
    officialUrls: {
      overview: SOURCES.oversikt,
      areas: SOURCES.areas,
      pm: "https://oringen.se/tavling/pm.html",
    },
    opening: {
      date: "2026-07-19",
      time: "15:30",
      venue: "Arena Tuve",
      note: "Bagheerastafetten と同時開催",
    },
    startWindows: [
      { discipline: "オリエンテーリング（徒歩）", window: "08:30–13:30" },
      { discipline: "MTBO", window: "10:00–12:30" },
    ],
    // 会場。徒歩とMTBOで別（日本勢は茅野浩司さんのみ MTBO）。
    venues: {
      foot: [
        { stages: [1, 2], name: "Jennylund", area: "Vättlefjäll 自然保護区", format: "ロング×2" },
        { stages: [3], name: "Slottsskogen", area: "イェーテボリ市内の公園", format: "短縮ミドル" },
        { stages: [4, 5], name: "Länsmansgården", area: "Hisingen / Svarte Mosse", format: "ミドル＋ロング" },
      ],
      mtbo: [
        { stages: [1, 2], name: "Delsjöterrängen", area: "イェーテボリ近郊", format: "ロング＋ミドル" },
        { stages: [3], name: "Hisingsparken", area: "O-Ringen 広場から自転車圏", format: "ミドル" },
        { stages: [4], name: "Gunnebo / Herkulesgården", area: "2023年SMスプリントと同エリア", format: "スプリント" },
        { stages: [5], name: "OK Landehof クラブハウス周辺", area: "スキースタジアム", format: "ロング" },
      ],
    },
    notes: [
      // 「7/22 は休養日」は日本勢にとっては正しいが、大会としては誤り。Elit はこの日にスプリントを走る。
      "7/22（水）は日本勢が出場するクラスに競技がない（3日目は 7/23）。ただし大会としては休養日ではなく、Elit クラスはこの日にスプリント（16:00–18:00）を行う。",
    ],
  };

  const out = join(process.cwd(), "src/data/oringen-program.json");
  writeFileSync(out, JSON.stringify(program, null, 2) + "\n", "utf8");
  console.log(`-> ${out}`);
  console.log(JSON.stringify(program.sources, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
