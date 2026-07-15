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
  difficulty: "https://oringen.se/tavling/svarighetsgrader.html",
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
  const difficulty = await getText(SOURCES.difficulty);

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
      {
        url: SOURCES.difficulty,
        hash: sectionHash(difficulty, "Svårighetsgrader Nivå", "PM Ny på O-Ringen"),
      },
    ],
    officialUrls: {
      overview: SOURCES.oversikt,
      areas: SOURCES.areas,
      pm: "https://oringen.se/tavling/pm.html",
      // PM は各ステージが個別ページ。日別の詳細（スタート地点名・地図の注意）はここ。
      // **見出しが「PM - Etapp N (Preliminärt)」＝暫定版**なので、翻訳して載せず原文へ送る。
      pmStages: [1, 2, 3, 4, 5].map((n) => `https://oringen.se/tavling/pm/etapp-${n}.html`),
      difficulty: SOURCES.difficulty,
      classes: "https://oringen.se/tavling/ol.html",
      travel: "https://oringen.se/resa.html",
      news: "https://oringen.se/nyheter.html",
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
    /**
     * 難易度（色）。**私の表に Blå / Gul / Orange / Svart というクラス名が並ぶのに、
     * 日本の読み手にはスウェーデン語の色が何を意味するか分からない**ため載せる。
     * 出典 https://oringen.se/tavling/svarighetsgrader.html の要約。固定情報で動かない。
     */
    difficultyLevels: [
      // hex は UI に出す色見本。凡例が「色」の話なのに色が出ていないと意味がないため持たせる。
      // ライト/ダーク両テーマで見えるよう、白と黒は枠線を付けて描く（UI 側で対応）。
      { sv: "Grön", ja: "緑", hex: "#2E9E4F", level: "初心者", desc: "道・柵・水路など明瞭な線状物の上か、すぐ脇にコントロール" },
      { sv: "Vit", ja: "白", hex: "#FFFFFF", level: "非常に易", desc: "緑と同じ地形。コントロールが線状物から少し離れるが、岩や明瞭な丘など分かりやすい地点" },
      { sv: "Gul", ja: "黄", hex: "#F2C200", level: "易", desc: "やや難しい地形。道から少し離れる。道と道の間をショートカットできる程度" },
      { sv: "Orange", ja: "橙", hex: "#E8720C", level: "中", desc: "湿地・崖・尾根・窪地なども辿る。近くに必ず明瞭な目標物がある" },
      { sv: "Lila", ja: "紫", hex: "#8E44AD", level: "中", desc: "橙・赤と同難度だがコントロール自体が難しい。単純化して確実に取る技術が要る" },
      { sv: "Blå", ja: "青", hex: "#1E6FBF", level: "難", desc: "上級者向け。等高線と細部の読図が大きな武器になる" },
      { sv: "Svart", ja: "黒", hex: "#1A1A1A", level: "難", desc: "青と同難度だが、あらゆる地形が出現しうる" },
    ],
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
