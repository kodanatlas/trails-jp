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
 */
export async function scrapeArchive(year?: number): Promise<JOEEvent[]> {
  const url = year ? `${BASE_URL}/event/archive?year=${year}` : `${BASE_URL}/event/archive`;
  const res = await fetch(url, {
    headers: { "User-Agent": "trails.jp/1.0 (event sync)" },
    next: { revalidate: 0 },
  });
  const html = await res.text();
  return parseEventList(html);
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

    // Date from date-sort attribute or first cell
    const dateSort = $row.attr("date-sort") ?? "";
    const dateText = cells.eq(0).text().trim();

    // Parse date range (e.g., "2026/3/14-15" or "2026/3/14")
    const { date, end_date } = parseDate(dateSort || dateText);

    // Event name
    const name = link.text().trim();

    // Location / Prefecture
    const locationText = cells.eq(2)?.text().trim() ?? "";

    // Entry status
    const statusText = cells.eq(3)?.text().trim() ?? "";
    const entry_status = statusText.includes("受付中")
      ? "open" as const
      : statusText.includes("締切")
      ? "closed" as const
      : "none" as const;

    // Tags
    const tagsText = cells.eq(4)?.text().trim() ?? "";
    const tags = tagsText
      .split(/[,、]/)
      .map((t) => t.trim())
      .filter(Boolean);

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

function parseDate(text: string): { date: string; end_date?: string } {
  // Handle date-sort format: "20260302"
  if (/^\d{8}$/.test(text)) {
    const y = text.slice(0, 4);
    const m = text.slice(4, 6);
    const d = text.slice(6, 8);
    return { date: `${y}-${m}-${d}` };
  }

  // Handle "2026/3/14" or "2026/3/14-15"
  const match = text.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})(?:-(\d{1,2}))?/);
  if (match) {
    const [, y, m, d, endD] = match;
    const date = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    const end_date = endD
      ? `${y}-${m.padStart(2, "0")}-${endD.padStart(2, "0")}`
      : undefined;
    return { date, end_date };
  }

  return { date: "" };
}
