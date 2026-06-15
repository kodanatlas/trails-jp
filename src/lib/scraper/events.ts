import * as cheerio from "cheerio";

export interface JOEEvent {
  joe_event_id: number;
  name: string;
  date: string;
  end_date?: string;
  event_type?: string;
  prefecture: string;
  venue?: string;
  entry_status: "open" | "closed" | "none";
  tags: string[];
  joe_url: string;
  recently_updated?: boolean;
  update_label?: string;
  lapcenter_event_id?: number;
  lapcenter_url?: string;
  /** 大会詳細ページから取得した座標（null = ページに座標なし） */
  lat?: number | null;
  lng?: number | null;
  /**
   * イベントの取得元。未指定/"joy" は japan-o-entry.com（既存・全件の既定）。
   * "dokori" は dokori.net（どこオリ）。joe_event_id は dokori 用に予約した
   * 合成ID（DOKORI_ID_BASE 以上）で、JOY の整数IDと衝突しない。
   */
  source?: "joy" | "dokori";
  /** source==="dokori" のときの どこオリ publicId（例: "evt_tortoise_50th"）。 */
  dokori_public_id?: string;
}

const BASE_URL = "https://japan-o-entry.com";

/**
 * japan-o-entry.com トップページからイベント一覧を取得
 */
export async function scrapeEvents(): Promise<JOEEvent[]> {
  const res = await fetch(BASE_URL, {
    headers: { "User-Agent": "trails.jp/1.0 (event sync)" },
    next: { revalidate: 0 },
  });
  const html = await res.text();
  return parseEventList(html);
}

/**
 * japan-o-entry.com アーカイブページから過去イベントを取得
 * URL: /event/archive/YYYY
 */
export async function scrapeArchive(year?: number): Promise<JOEEvent[]> {
  const url = year ? `${BASE_URL}/event/archive/${year}` : `${BASE_URL}/event/archive`;
  const res = await fetch(url, {
    headers: { "User-Agent": "trails.jp/1.0 (event sync)" },
    next: { revalidate: 0 },
  });
  const html = await res.text();
  return parseArchiveList(html);
}

/**
 * アーカイブページのHTML（table.indexではない2列テーブル）をパース
 */
function parseArchiveList(html: string): JOEEvent[] {
  const $ = cheerio.load(html);
  const events: JOEEvent[] = [];

  $("table tr").each((_, row) => {
    const $row = $(row);
    const cells = $row.find("td");
    if (cells.length < 2) return;

    const link = $row.find("a[href*='/event/view/']");
    if (!link.length) return;

    const href = link.attr("href") ?? "";
    const idMatch = href.match(/\/event\/view\/(\d+)/);
    if (!idMatch) return;

    const joe_event_id = parseInt(idMatch[1], 10);
    const name = link.text().trim();

    // 日付: "2024/ 1/2 (火) " or "2024/ 1/7 - 3/20"
    const dateText = cells.eq(0).text().trim();
    const { date, end_date } = parseArchiveDate(dateText);
    if (!date) return;

    // 場所: リンクの後のテキスト (e.g. " 東京都青梅市")
    const cellHtml = cells.eq(1).text().trim();
    const nameEnd = cellHtml.lastIndexOf(name);
    let location = "";
    if (nameEnd >= 0) {
      location = cellHtml.slice(nameEnd + name.length).trim();
    }
    // clean up leading/trailing special chars
    location = location.replace(/^[)）\s]+/, "").trim();

    events.push({
      joe_event_id,
      name,
      date,
      end_date,
      prefecture: location,
      venue: location,
      entry_status: "closed",
      tags: [],
      joe_url: `${BASE_URL}/event/view/${joe_event_id}`,
    });
  });

  return events;
}

function parseArchiveDate(text: string): { date: string; end_date?: string } {
  // "2024/ 1/2 (火) " → "2024-01-02"
  // "2024/ 1/7 - 3/20" → date: "2024-01-07", end_date: "2024-03-20"
  const match = text.match(/(\d{4})\s*\/\s*(\d{1,2})\s*\/\s*(\d{1,2})/);
  if (!match) return { date: "" };

  const [, y, m, d] = match;
  const date = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;

  // Check for end date: " - M/D"
  const rangeMatch = text.match(/-\s*(\d{1,2})\/(\d{1,2})/);
  let end_date: string | undefined;
  if (rangeMatch) {
    const [, em, ed] = rangeMatch;
    end_date = `${y}-${em.padStart(2, "0")}-${ed.padStart(2, "0")}`;
  }

  return { date, end_date };
}

function parseEventList(html: string): JOEEvent[] {
  const $ = cheerio.load(html);
  const events: JOEEvent[] = [];

  $("table.index tbody tr").each((_, row) => {
    const $row = $(row);
    const cells = $row.find("td");
    if (cells.length < 2) return;

    // Extract link and event ID
    const link = $row.find("a[href*='/event/view/']");
    if (!link.length) return;

    const href = link.attr("href") ?? "";
    const idMatch = href.match(/\/event\/view\/(\d+)/);
    if (!idMatch) return;

    const joe_event_id = parseInt(idMatch[1], 10);

    // Date from "date" attribute (YYYY-MM-DD) or legacy "date-sort" (YYYYMMDD)
    const dateAttr = $row.attr("date") ?? $row.attr("date-sort") ?? "";
    const dateText = cells.eq(0).text().trim();

    // Parse date from attribute first, then cell text
    const { date, end_date } = parseDateWithAttr(dateAttr, dateText);

    // Event name
    const name = link.text().trim();

    // --- 新構造対応 (3カラム: 日付 | イベント名・開催地 | 申込) ---
    const infoCell = cells.eq(1);

    // Tags: span.event_icon から取得
    const tags: string[] = [];
    infoCell.find("span.event_icon").each((_, el) => {
      const t = $(el).text().trim();
      if (t && t !== "-") tags.push(t);
    });

    // Location: イベント名リンクの後のテキストから都道府県・会場を抽出
    const fullText = infoCell.text().trim();
    const nameIdx = fullText.lastIndexOf(name);
    let locationText = "";
    if (nameIdx >= 0) {
      locationText = fullText.slice(nameIdx + name.length).trim();
      // 先頭の括弧や改行を除去、最初の行だけ取得
      locationText = locationText.split("\n")[0].trim();
      // "(その他)" のような値はクリーン
      locationText = locationText.replace(/^\(|\)$/g, "").trim();
      if (locationText === "その他") locationText = "";
    }

    // Entry status: 最後のセルから取得
    // JOY は受付中の大会を「受付中」だけでなく締切カウントダウン「あと N 日」でも表示するため、
    // これも open として扱う（さもないと締切間近の受付中大会が none＝バッジ非表示になる）。
    const statusCell = cells.eq(cells.length - 1);
    const statusText = statusCell.text().trim();
    const entry_status =
      statusText.includes("受付中") || /あと\s*\d+\s*日/.test(statusText)
        ? ("open" as const)
        : statusText.includes("締切")
        ? ("closed" as const)
        : ("none" as const);

    events.push({
      joe_event_id,
      name,
      date,
      end_date,
      prefecture: locationText,
      venue: locationText,
      entry_status,
      tags,
      joe_url: `${BASE_URL}/event/view/${joe_event_id}`,
    });
  });

  return events;
}

/**
 * 年なし "M/D" 表記の年を推定する。
 * JOY のトップページは直近〜半年の大会で年を省略（例: "6/14 (日)"）し、
 * 半年より先・年跨ぎの大会のみ "2027/ 1/9" のように年を明示する。
 * よって年なし日付は「今日に最も近い年（前年・今年・翌年）」を選べば一意に定まる
 * （12月↔1月の跨ぎも双方向に正しく解決する）。基準は JST。
 */
function inferYearForMonthDay(month: number, day: number): number {
  const nowJst = new Date(Date.now() + 9 * 3600 * 1000);
  const cy = nowJst.getUTCFullYear();
  const todayMs = Date.UTC(cy, nowJst.getUTCMonth(), nowJst.getUTCDate());
  let best = cy;
  let bestDiff = Infinity;
  for (const y of [cy - 1, cy, cy + 1]) {
    const diff = Math.abs(Date.UTC(y, month - 1, day) - todayMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = y;
    }
  }
  return best;
}

/**
 * 年なしの「年跨ぎレンジ」（終了月 < 開始月。例 "12/27 - 1/3"）の開始年を推定する。
 * inferYearForMonthDay は開始日(12月)単体で最近接年を選ぶため、年央(6月など)では
 * 前年12月の方が近く開始日を過去年に丸めてしまう。JOYは直近の大会のみ年を省くので、
 * 「終了日(翌年 em/ed)が今日以降になる最小の開始年」を採れば、進行中・直近の年跨ぎ大会を正しく拾える。
 * 基準は JST。
 */
function startYearForCrossingRange(
  endMonth: number,
  endDay: number,
): number {
  const nowJst = new Date(Date.now() + 9 * 3600 * 1000);
  const cy = nowJst.getUTCFullYear();
  const todayMs = Date.UTC(cy, nowJst.getUTCMonth(), nowJst.getUTCDate());
  for (const sy of [cy - 1, cy, cy + 1]) {
    // 終了は翌年（em < sm の年跨ぎ前提）
    if (Date.UTC(sy + 1, endMonth - 1, endDay) >= todayMs) return sy;
  }
  return cy;
}

/**
 * date 属性 (YYYY-MM-DD) とセルテキストから日付を解析。
 * 属性がある場合はそちらを優先し、セルテキストから end_date を抽出。
 */
function parseDateWithAttr(
  dateAttr: string,
  cellText: string
): { date: string; end_date?: string } {
  let date = "";

  // 1. date 属性が YYYY-MM-DD 形式ならそのまま使用
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateAttr)) {
    date = dateAttr;
  }
  // 2. Legacy: date-sort が YYYYMMDD 形式
  else if (/^\d{8}$/.test(dateAttr)) {
    date = `${dateAttr.slice(0, 4)}-${dateAttr.slice(4, 6)}-${dateAttr.slice(6, 8)}`;
  }
  // 3. セルテキストから年付き日付を試行: "2026/3/14" or "2026/ 1/7"
  else {
    const match = cellText.match(/(\d{4})\s*\/\s*(\d{1,2})\s*\/\s*(\d{1,2})/);
    if (match) {
      const [, y, m, d] = match;
      date = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    } else {
      // 4. 年なし "M/D"（JOYは直近〜半年の大会で年を省略: "6/14 (日)" / "6/20 - 21"）。
      //    JOYが date 属性も廃止したため、ここで今日に最も近い年を推定して補完する。
      //    これが無いと近接大会が date="" となり、エントリー集計(sync-entries)から脱落する。
      const md = cellText.match(/(\d{1,2})\s*\/\s*(\d{1,2})/);
      if (md) {
        const m = parseInt(md[1], 10);
        const d = parseInt(md[2], 10);
        // 月>12・日>31 の不正値は採用しない（日付セルにノイズが混じった際の誤dateを防ぐ）
        if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
          // 年跨ぎレンジ（終了月<開始月, 例 "12/27 - 1/3"）は開始日を最近接年で丸めると
          // 過去年に倒れるため、終了日基準で開始年を決める。それ以外は最近接年。
          const rm = cellText.match(/-\s*(\d{1,2})\/(\d{1,2})/);
          const em = rm ? parseInt(rm[1], 10) : null;
          const ed = rm ? parseInt(rm[2], 10) : null;
          const y =
            em !== null && ed !== null && em < m
              ? startYearForCrossingRange(em, ed)
              : inferYearForMonthDay(m, d);
          date = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        }
      }
    }
  }

  if (!date) return { date: "" };

  // end_date 抽出: "- M/D" or "- D" パターン
  const year = date.slice(0, 4);
  const month = date.slice(5, 7);
  let end_date: string | undefined;

  // "M/D - M/D" or "YYYY/M/D - M/D"
  const rangeMatch = cellText.match(/-\s*(\d{1,2})\/(\d{1,2})/);
  if (rangeMatch) {
    const [, em, ed] = rangeMatch;
    // 年跨ぎレンジ（例: 12/27 - 1/3）は終了側の年を繰り上げる
    const endYear =
      parseInt(em, 10) < parseInt(month, 10) ? String(Number(year) + 1) : year;
    end_date = `${endYear}-${em.padStart(2, "0")}-${ed.padStart(2, "0")}`;
  } else {
    // "3/14-15" (same month, different day)
    const sameMoMatch = cellText.match(/(\d{1,2})\s*-\s*(\d{1,2})(?:\s|$|\))/);
    if (sameMoMatch) {
      const endD = sameMoMatch[2];
      end_date = `${year}-${month}-${endD.padStart(2, "0")}`;
    }
  }

  return { date, end_date };
}

// --- 座標取得 ---

const COORD_RE = /var\s+lat\s*=\s*([0-9.-]+)\s*;\s*var\s+lng\s*=\s*([0-9.-]+)\s*;/;

/**
 * JOY大会詳細ページからLeaflet地図の座標を抽出
 */
export async function scrapeEventCoordinates(
  joeUrl: string
): Promise<{ lat: number; lng: number } | null> {
  const res = await fetch(joeUrl, {
    headers: { "User-Agent": "trails.jp/1.0 (event sync)" },
  });
  if (!res.ok) return null;
  const html = await res.text();
  const match = html.match(COORD_RE);
  if (!match) return null;
  const lat = parseFloat(match[1]);
  const lng = parseFloat(match[2]);
  if (isNaN(lat) || isNaN(lng)) return null;
  // 日本の座標範囲チェック
  if (lat < 20 || lat > 50 || lng < 120 || lng > 155) return null;
  return { lat, lng };
}

/**
 * 座標未取得のイベントに対してバッチで座標を付与
 * @param events 対象イベント配列（in-placeで更新）
 * @param batchSize 1回で処理する最大件数
 * @param delayMs リクエスト間の待機時間(ms)
 */
export async function enrichEventsWithCoordinates(
  events: JOEEvent[],
  batchSize = 50,
  delayMs = 500
): Promise<{ enriched: number; skipped: number; failed: number }> {
  let enriched = 0;
  let skipped = 0;
  let failed = 0;
  let processed = 0;

  for (const event of events) {
    // lat が undefined でないものはスキップ（null = 座標なしページ確認済み）
    if (event.lat !== undefined) {
      skipped++;
      continue;
    }
    if (processed >= batchSize) break;

    try {
      const coords = await scrapeEventCoordinates(event.joe_url);
      event.lat = coords?.lat ?? null;
      event.lng = coords?.lng ?? null;
      if (coords) enriched++;
    } catch {
      failed++;
      // lat を undefined のまま残し、次回リトライ
    }

    processed++;
    if (delayMs > 0 && processed < batchSize) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  return { enriched, skipped, failed };
}
