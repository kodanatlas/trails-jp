/**
 * japan-o-entry.com からイベントデータを全件取得して JSON に保存
 * 実行: node scripts/scrape-events.mjs
 */
import * as cheerio from "cheerio";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_URL = "https://japan-o-entry.com";

/**
 * トップページからイベント一覧を取得（エントリー状態付き）
 */
async function scrapeTopPage() {
  console.log("トップページ取得中...");
  const res = await fetch(BASE_URL, {
    headers: { "User-Agent": "trails.jp/1.0 (event sync)" },
  });
  const html = await res.text();
  const $ = cheerio.load(html);
  const events = [];

  $("table.index tr").each((_, tr) => {
    const $tr = $(tr);
    const tds = $tr.find("td");
    if (tds.length < 2) return;

    // td1 にイベントリンクがある
    const link = tds.eq(1).find("a[href*='/event/view/']").first();
    if (!link.length) return;

    const href = link.attr("href") || "";
    const idMatch = href.match(/\/event\/view\/(\d+)/);
    if (!idMatch) return;

    const joe_event_id = parseInt(idMatch[1], 10);
    const name = link.text().trim();

    // 日付パース
    const dateText = tds.eq(0).text().trim();
    const { date, end_date } = parseDate(dateText);

    // 種別（最初の span）
    const typeSpan = tds.eq(1).find("span").first().text().trim();
    const event_type = typeSpan || "";

    // 場所: リンクの後のテキストノード（都道府県や会場名）
    const td1Text = tds.eq(1).text().trim();
    const prefecture = extractLocation(td1Text, name);

    // タグ
    const tags = [];
    tds.eq(1).find("span").each((i, span) => {
      if (i === 0) return; // 最初は種別
      const tag = $(span).text().trim();
      if (tag && !tags.includes(tag)) tags.push(tag);
    });

    // エントリー状態
    const statusText = tds.length >= 3 ? tds.eq(2).text().trim() : "";
    const entry_status = parseEntryStatus(statusText);

    const joe_url = href.startsWith("http") ? href : BASE_URL + href;

    events.push({
      joe_event_id, name, date, end_date, event_type,
      prefecture, tags, entry_status, joe_url,
    });
  });

  console.log(`  トップページ: ${events.length} 件`);
  return events;
}

/**
 * アーカイブページからイベント一覧を取得
 */
async function scrapeArchive(year) {
  const url = `${BASE_URL}/event/archive/${year}`;
  console.log(`アーカイブ ${year} 取得中...`);
  const res = await fetch(url, {
    headers: { "User-Agent": "trails.jp/1.0 (event sync)" },
  });
  if (!res.ok) {
    console.log(`  エラー: HTTP ${res.status}`);
    return [];
  }
  const html = await res.text();
  const $ = cheerio.load(html);
  const events = [];

  $("table tr").each((_, tr) => {
    const $tr = $(tr);
    const tds = $tr.find("td");
    if (tds.length < 2) return;

    const link = $tr.find("a[href*='/event/view/']").first();
    if (!link.length) return;

    const href = link.attr("href") || "";
    const idMatch = href.match(/\/event\/view\/(\d+)/);
    if (!idMatch) return;

    const joe_event_id = parseInt(idMatch[1], 10);
    const name = link.text().trim();

    const dateText = tds.eq(0).text().trim();
    const { date, end_date } = parseDate(dateText, year);

    const td1Text = tds.eq(1).text().trim();
    const prefecture = extractLocation(td1Text, name);

    // アーカイブにはタグや種別の span がない場合が多い
    const tags = [];
    const event_type = "";

    const joe_url = href.startsWith("http") ? href : BASE_URL + href;

    events.push({
      joe_event_id, name, date, end_date, event_type,
      prefecture, tags, entry_status: "none",
      joe_url,
    });
  });

  console.log(`  アーカイブ ${year}: ${events.length} 件`);
  return events;
}

/** 日付テキストをパース */
function parseDate(text, defaultYear) {
  // "2026/ 1/7 - 3/20" or "2/28 (土)" or "2/28 - 26" or "2/25 - 26"
  const now = new Date();
  const year = defaultYear || now.getFullYear();

  // Full year format: "2026/ 1/7" or "2026/ 1/7 - 3/20"
  const fullMatch = text.match(/(\d{4})\s*\/\s*(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*-\s*(?:(\d{1,2})\s*\/\s*)?(\d{1,2}))?/);
  if (fullMatch) {
    const [, y, m, d, endM, endD] = fullMatch;
    const date = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    let end_date;
    if (endD) {
      const em = endM || m;
      end_date = `${y}-${em.padStart(2, "0")}-${endD.padStart(2, "0")}`;
    }
    return { date, end_date };
  }

  // Short format: "2/28 (土)" or "2/28 - 3/1" or "2/25 - 26"
  const shortMatch = text.match(/(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*-\s*(?:(\d{1,2})\s*\/\s*)?(\d{1,2}))?/);
  if (shortMatch) {
    const [, m, d, endM, endD] = shortMatch;
    const date = `${year}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    let end_date;
    if (endD) {
      const em = endM || m;
      end_date = `${year}-${em.padStart(2, "0")}-${endD.padStart(2, "0")}`;
    }
    return { date, end_date };
  }

  return { date: "" };
}

/** イベント名の後のテキストから地名を抽出 */
function extractLocation(fullText, eventName) {
  // イベント名以降のテキストから都道府県を探す
  const idx = fullText.indexOf(eventName);
  const after = idx >= 0 ? fullText.substring(idx + eventName.length).trim() : fullText;

  // 都道府県パターン
  const prefMatch = after.match(/(北海道|青森県|岩手県|宮城県|秋田県|山形県|福島県|茨城県|栃木県|群馬県|埼玉県|千葉県|東京都|神奈川県|新潟県|富山県|石川県|福井県|山梨県|長野県|岐阜県|静岡県|愛知県|三重県|滋賀県|京都府|大阪府|兵庫県|奈良県|和歌山県|鳥取県|島根県|岡山県|広島県|山口県|徳島県|香川県|愛媛県|高知県|福岡県|佐賀県|長崎県|熊本県|大分県|宮崎県|鹿児島県|沖縄県)/);
  if (prefMatch) return prefMatch[1];

  // 「○○市」「○○町」「○○村」パターン
  const cityMatch = after.match(/([^\s「」]+?[市町村区])/);
  if (cityMatch) return cityMatch[1];

  // カッコ内の地名
  const bracketMatch = after.match(/「([^」]+)」/);
  if (bracketMatch) return bracketMatch[1];

  // 最初の非空白文字列
  const firstWord = after.replace(/[（(][^)）]*[)）]/g, "").trim().split(/\s+/)[0];
  return firstWord || "";
}

/** エントリー状態をパース */
function parseEntryStatus(text) {
  if (!text || text === "-") return "none";
  if (text.includes("受付中") || text.includes("あと")) return "open";
  if (text.includes("締切")) return "closed";
  return "none";
}

/**
 * トップページの更新履歴セクションからイベントIDとラベルを取得
 */
async function scrapeUpdateHistory() {
  console.log("更新履歴取得中...");
  const res = await fetch(BASE_URL, {
    headers: { "User-Agent": "trails.jp/1.0 (event sync)" },
  });
  const html = await res.text();
  const $ = cheerio.load(html);

  // 更新履歴: Map<event_id, update_label>
  const updates = new Map();

  // 更新履歴セクション内のリンクからイベントIDを抽出
  // 構造: <h2>更新履歴</h2> の後のコンテンツ
  let inHistory = false;
  $("h2, h3, div, p, li, a, table").each((_, el) => {
    const $el = $(el);
    const tagName = el.tagName?.toLowerCase();

    // 更新履歴の見出しを見つける
    if ((tagName === "h2" || tagName === "h3") && $el.text().includes("更新履歴")) {
      inHistory = true;
      return;
    }
    // 次の見出しで終了
    if (inHistory && (tagName === "h2" || tagName === "h3") && !$el.text().includes("更新履歴")) {
      inHistory = false;
      return;
    }

    if (!inHistory) return;

    // リンクからイベントIDを抽出
    if (tagName === "a") {
      const href = $el.attr("href") || "";
      const idMatch = href.match(/\/event\/view\/(\d+)/);
      if (idMatch) {
        const eventId = parseInt(idMatch[1], 10);
        if (!updates.has(eventId)) {
          // 親要素のテキストから更新ラベルを取得（【新着】【受付開始】等）
          const parentText = $el.parent().text() || "";
          const labelMatch = parentText.match(/【([^】]+)】/);
          const label = labelMatch ? labelMatch[1] : "更新";
          updates.set(eventId, label);
        }
      }
    }
  });

  console.log(`  更新履歴: ${updates.size} 件`);
  return updates;
}

async function main() {
  console.log("japan-o-entry.com イベント全件取得開始\n");

  // トップページ（現在〜未来のイベント、エントリー状態付き）
  const topEvents = await scrapeTopPage();
  await new Promise(r => setTimeout(r, 1500));

  // 更新履歴
  const updateHistory = await scrapeUpdateHistory();

  // アーカイブ（過去〜現在）- 直近2年分
  const currentYear = new Date().getFullYear();
  const archiveEvents = [];
  for (const year of [currentYear - 1, currentYear, currentYear + 1]) {
    const events = await scrapeArchive(year);
    archiveEvents.push(...events);
    await new Promise(r => setTimeout(r, 1500));
  }

  // マージ（トップページのデータを優先、IDで重複排除）
  const byId = new Map();
  // まずアーカイブを入れる
  for (const e of archiveEvents) {
    if (e.joe_event_id && e.date) byId.set(e.joe_event_id, e);
  }
  // トップページで上書き（エントリー状態やタグがより正確）
  for (const e of topEvents) {
    if (e.joe_event_id && e.date) byId.set(e.joe_event_id, e);
  }

  // 更新履歴フラグを付与
  for (const [eventId, label] of updateHistory) {
    const event = byId.get(eventId);
    if (event) {
      event.recently_updated = true;
      event.update_label = label;
    }
  }

  const allEvents = [...byId.values()].sort((a, b) => a.date.localeCompare(b.date));

  console.log(`\nマージ結果: ${allEvents.length} 件（重複排除済み）`);
  console.log(`  更新履歴付き: ${allEvents.filter(e => e.recently_updated).length} 件`);

  // 保存
  const pubDir = join(__dirname, "..", "public", "data");
  mkdirSync(pubDir, { recursive: true });
  writeFileSync(join(pubDir, "events.json"), JSON.stringify(allEvents));

  const srcDir = join(__dirname, "..", "src", "data");
  mkdirSync(srcDir, { recursive: true });
  writeFileSync(join(srcDir, "events.json"), JSON.stringify(allEvents, null, 2));

  // サマリー
  const open = allEvents.filter(e => e.entry_status === "open").length;
  const closed = allEvents.filter(e => e.entry_status === "closed").length;
  console.log(`  受付中: ${open} / 締切済: ${closed} / その他: ${allEvents.length - open - closed}`);
  console.log(`保存先: public/data/events.json, src/data/events.json`);
}

main().catch(console.error);
