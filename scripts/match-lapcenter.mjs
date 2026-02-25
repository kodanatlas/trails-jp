/**
 * Lap Center (mulka2.com) のイベント一覧を取得し、
 * JOE (japan-o-entry.com) のイベントとマッチングして
 * lapcenter_event_id / lapcenter_url を付与する
 *
 * 実行: node scripts/match-lapcenter.mjs
 */
import * as cheerio from "cheerio";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_URL = "https://mulka2.com/lapcenter";
const DELAY_MS = 1500;

// ---------------------------------------------------------------------------
// Lap Center からイベント一覧を取得
// ---------------------------------------------------------------------------

/**
 * 指定年のイベント一覧を取得
 * HTML 構造:
 *   <table class="table table-condensed">
 *     <tr>
 *       <td>1月</td>           ← 月 (空なら前行と同じ月)
 *       <td>3日 (金)</td>      ← 日
 *       <td>                   ← イベントリンク群
 *         <a href="index.jsp?event=8873">イベント名</a><br>
 *         ...
 *       </td>
 *     </tr>
 */
async function fetchLapCenterEvents(year) {
  const url = `${BASE_URL}/index.jsp?year=${year}`;
  console.log(`Lap Center ${year} 取得中: ${url}`);

  const res = await fetch(url, {
    headers: { "User-Agent": "trails.jp/1.0 (lapcenter match)" },
  });
  if (!res.ok) {
    console.log(`  エラー: HTTP ${res.status}`);
    return [];
  }

  const html = await res.text();
  const $ = cheerio.load(html);
  const events = [];

  let currentMonth = 0;

  $("table.table-condensed tr").each((_, tr) => {
    const tds = $(tr).find("td");
    if (tds.length < 3) return;

    // 月の取得
    const monthText = tds.eq(0).text().trim();
    const monthMatch = monthText.match(/(\d{1,2})月/);
    if (monthMatch) {
      currentMonth = parseInt(monthMatch[1], 10);
    }
    if (!currentMonth) return;

    // 日の取得
    const dayText = tds.eq(1).text().trim();
    const dayMatch = dayText.match(/(\d{1,2})日/);
    if (!dayMatch) return;
    const day = parseInt(dayMatch[1], 10);

    const date = `${year}-${String(currentMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

    // イベントリンクの取得
    tds.eq(2).find("a[href*='event=']").each((_, a) => {
      const href = $(a).attr("href") || "";
      const idMatch = href.match(/event=(\d+)/);
      if (!idMatch) return;

      const eventId = parseInt(idMatch[1], 10);
      const name = $(a).text().trim();
      if (!name) return;

      events.push({ eventId, name, date });
    });
  });

  console.log(`  ${year}: ${events.length} 件取得`);
  return events;
}

// ---------------------------------------------------------------------------
// ファジーマッチング
// ---------------------------------------------------------------------------

/** マッチングで無視するストップワード (正規化後) */
const STOP_WORDS = new Set([
  "大会", "練習会", "練習", "オリエンテーリング", "オリエンテーリン", "スプリント", "ミドル",
  "ロング", "リレー", "公開", "午前", "午後", "の部", "1日目", "2日目",
  "3日目", "day1", "day2", "day3", "Day1", "Day2", "Day3",
  "兼", "in", "IN", "OL", "ロゲイニング",
  "年度", "記念", "中止", "競技", "選手権", "体験会", "講習会",
  "日本", "全国", "地区", "JOA", "OLC", "杯", "壮行会", "日本代表",
  "パーク", "県民", "市民",
]);

/**
 * イベント名を正規化: 第XX回、空白、特殊文字を除去
 */
function normalize(name) {
  let s = name;
  // 全角→半角の基本変換
  s = s.replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0)
  );
  // 【中止】等のタグを除去
  s = s.replace(/【[^】]*】/g, "");
  // 第XX回 を除去
  s = s.replace(/第\s*[0-9一二三四五六七八九十百千]+\s*回/g, "");
  // 年度・年を除去
  s = s.replace(/(令和|平成|昭和)\s*[0-9一二三四五六七八九十]+\s*年度?/g, "");
  s = s.replace(/20\d{2}年度?/g, "");
  // 日付パターンを除去 (20250112 等)
  s = s.replace(/20\d{6}/g, "");
  // 括弧内を除去
  s = s.replace(/[（(][^)）]*[)）]/g, "");
  // 特殊文字・空白を除去してトークン化
  s = s.replace(/[・\-\s　&＆「」『』【】〜～/／\\.,、。!！?？:：;；#＃@＠+＋=＝_＿<>＜＞'"'"'"^`~|｜{}\[\]［］]/g, " ");
  // 連続空白をトリム
  return s.trim();
}

/**
 * トークンがストップワード（またはその部分文字列）かどうかをチェック
 */
function isStopRelated(token) {
  if (STOP_WORDS.has(token)) return true;
  // トークンがいずれかのストップワードの部分文字列ならストップ扱い
  for (const sw of STOP_WORDS) {
    if (sw.includes(token) && token.length < sw.length) return true;
  }
  return false;
}

/**
 * 正規化した名前から意味のあるキーワード (3文字以上、ストップワード除外) を抽出
 */
function extractSignificantTokens(normalizedName) {
  const tokens = normalizedName.split(/\s+/).filter((t) => t.length >= 3);
  return tokens.filter((t) => !isStopRelated(t));
}

/**
 * 正規化文字列からストップワードを除去した「コア文字列」を生成
 */
function coreString(normalizedName) {
  let s = normalizedName.replace(/\s+/g, "");
  // ストップワードを除去
  for (const sw of STOP_WORDS) {
    s = s.replaceAll(sw, "");
  }
  return s;
}

/**
 * 2つのイベント名がファジーマッチするかチェック
 * ストップワードを除いた上で、有意なキーワードの一致を確認
 */
function fuzzyMatch(name1, name2) {
  const norm1 = normalize(name1);
  const norm2 = normalize(name2);
  const full1 = norm1.replace(/\s+/g, "");
  const full2 = norm2.replace(/\s+/g, "");

  // 正規化後の文字列が空なら不一致
  if (!full1 || !full2) return false;

  // 完全一致 (正規化後)
  if (full1 === full2) return true;

  // 一方が他方を含む (長さが短い方が4文字以上の場合のみ)
  const shorter = full1.length <= full2.length ? full1 : full2;
  const longer = full1.length <= full2.length ? full2 : full1;
  if (shorter.length >= 4 && longer.includes(shorter)) return true;

  // ストップワード除去後のコア文字列で比較
  const core1 = coreString(norm1);
  const core2 = coreString(norm2);

  if (core1.length >= 3 && core2.length >= 3) {
    // コア完全一致
    if (core1 === core2) return true;
    // コア包含 (短い方が4文字以上)
    const cShorter = core1.length <= core2.length ? core1 : core2;
    const cLonger = core1.length <= core2.length ? core2 : core1;
    if (cShorter.length >= 4 && cLonger.includes(cShorter)) return true;
  }

  // トークンベース: ストップワードを除いた有意なトークン
  const tokens1 = extractSignificantTokens(norm1);
  const tokens2 = extractSignificantTokens(norm2);

  // 有意なトークンが1つもない場合はコア文字列のトライグラム比較へ
  if (tokens1.length > 0 && tokens2.length > 0) {
    // 双方向チェック: tokens1 のいずれかが full2 に含まれ、
    // かつ tokens2 のいずれかが full1 に含まれる
    const t1InF2 = tokens1.some((t) => full2.includes(t));
    const t2InF1 = tokens2.some((t) => full1.includes(t));
    if (t1InF2 && t2InF1) return true;

    // 片方向でも、十分長いトークン (5文字以上、ストップ関連除外) が含まれればOK
    for (const t of tokens1) {
      if (t.length >= 5 && !isStopRelated(t) && full2.includes(t)) return true;
    }
    for (const t of tokens2) {
      if (t.length >= 5 && !isStopRelated(t) && full1.includes(t)) return true;
    }
  }

  // コア文字列のトライグラム比較 (最終手段、厳しめに)
  if (core1.length >= 5 && core2.length >= 5) {
    const trigrams1 = new Set();
    for (let i = 0; i <= core1.length - 3; i++) {
      trigrams1.add(core1.substring(i, i + 3));
    }
    let common = 0;
    const total2 = Math.max(1, core2.length - 2);
    for (let i = 0; i <= core2.length - 3; i++) {
      if (trigrams1.has(core2.substring(i, i + 3))) common++;
    }
    // 両方向の比率が65%以上、かつ共通トライグラムが5以上
    const ratio1 = common / trigrams1.size;
    const ratio2 = common / total2;
    if (Math.min(ratio1, ratio2) >= 0.65 && common >= 5) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// メイン処理
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== Lap Center マッチング開始 ===\n");

  // 1. Lap Center イベント取得
  const lcEvents = [];
  for (const year of [2025, 2026]) {
    const events = await fetchLapCenterEvents(year);
    lcEvents.push(...events);
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  console.log(`\nLap Center 合計: ${lcEvents.length} 件\n`);

  // 2. 既存 events.json 読み込み
  const srcPath = join(__dirname, "..", "src", "data", "events.json");
  const joeEvents = JSON.parse(readFileSync(srcPath, "utf-8"));
  console.log(`JOE イベント: ${joeEvents.length} 件\n`);

  // 既存の lapcenter フィールドをクリア (再実行時のため)
  for (const e of joeEvents) {
    delete e.lapcenter_event_id;
    delete e.lapcenter_url;
  }

  // 3. 日付でグループ化 (Lap Center 側)
  const lcByDate = new Map();
  for (const lc of lcEvents) {
    if (!lcByDate.has(lc.date)) lcByDate.set(lc.date, []);
    lcByDate.get(lc.date).push(lc);
  }

  // 4. マッチング (日付完全一致のみ - end_date 範囲は使わない)
  let matchCount = 0;
  const matchedPairs = [];
  const usedLcIds = new Set(); // 同一 LC イベントの二重マッチを防止

  for (const joe of joeEvents) {
    // 既に lapcenter_event_id がある場合はスキップ
    if (joe.lapcenter_event_id) continue;

    // 同じ日付の Lap Center イベントを取得
    const candidates = lcByDate.get(joe.date) || [];
    if (candidates.length === 0) continue;

    // 名前でファジーマッチ (未使用の候補のみ)
    let bestMatch = null;
    for (const lc of candidates) {
      if (usedLcIds.has(lc.eventId)) continue;
      if (fuzzyMatch(joe.name, lc.name)) {
        bestMatch = lc;
        break;
      }
    }

    if (bestMatch) {
      joe.lapcenter_event_id = bestMatch.eventId;
      joe.lapcenter_url = `https://mulka2.com/lapcenter/lapcombat2/index.jsp?event=${bestMatch.eventId}&file=1`;
      usedLcIds.add(bestMatch.eventId);
      matchCount++;
      matchedPairs.push({
        joe: `[${joe.joe_event_id}] ${joe.name} (${joe.date})`,
        lc: `[${bestMatch.eventId}] ${bestMatch.name} (${bestMatch.date})`,
      });
    }
  }

  console.log(`マッチ結果: ${matchCount} 件\n`);
  console.log("--- マッチ一覧 ---");
  for (const pair of matchedPairs) {
    console.log(`  JOE: ${pair.joe}`);
    console.log(`   LC: ${pair.lc}`);
    console.log();
  }

  // 5. 保存
  const pubDir = join(__dirname, "..", "public", "data");
  mkdirSync(pubDir, { recursive: true });
  writeFileSync(join(pubDir, "events.json"), JSON.stringify(joeEvents));

  const srcDir = join(__dirname, "..", "src", "data");
  mkdirSync(srcDir, { recursive: true });
  writeFileSync(join(srcDir, "events.json"), JSON.stringify(joeEvents, null, 2));

  console.log(`保存完了: src/data/events.json, public/data/events.json`);
  console.log(`  マッチ済み: ${matchCount} / ${joeEvents.length} 件`);
}

main().catch(console.error);
