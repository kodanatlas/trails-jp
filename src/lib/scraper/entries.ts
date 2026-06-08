import * as cheerio from "cheerio";
import { splitAffiliations } from "@/lib/club-normalize";

const BASE_URL = "https://japan-o-entry.com";
const NO_AFFILIATION = "所属なし";

/** エントリー1件（個人 or リレー1チーム） */
export interface EntryRow {
  /** クラス (M21A 等) */
  className: string;
  /** チーム名(氏名) */
  name: string;
  /** 所属（生文字列） */
  affiliation: string;
  /** メンバー（"-" 以外のときのみ。リレー用） */
  members?: string;
}

/** 所属（クラブ）単位のグループ */
export interface TeamGroup {
  /** 正規化後のクラブ名（空欄は「所属なし」） */
  affiliation: string;
  /** このクラブのエントリー数 */
  count: number;
  entries: EntryRow[];
}

export interface EntryListResult {
  eventId: number;
  /** 実エントリー件数（=ユニーク人数）。複数所属による二重計上を含まない */
  total: number;
  /** count 降順、同数は所属名で安定ソート */
  teams: TeamGroup[];
  fetchedAt: string;
}

/**
 * JOY 大会詳細ページ（show_detail）のHTMLからエントリーリストを抽出し、
 * 所属（クラブ）単位でグループ化する。複数所属は分割して各クラブに計上（二重計上）。
 */
export function parseEntryList(html: string, eventId: number): EntryListResult {
  const $ = cheerio.load(html);

  // 「N 人が申込済です」から公称人数を取得（フォールバック用）
  const announcedMatch = $.text().match(/([\d,]+)\s*人が申込済/);
  const announced = announcedMatch
    ? parseInt(announcedMatch[1].replace(/,/g, ""), 10)
    : null;

  // ヘッダに「チーム名」を含むテーブル（=エントリーリスト）を特定
  const tables = $("table").toArray();
  const targetTable = tables.find((t) =>
    $(t)
      .find("th")
      .toArray()
      .some((th) => $(th).text().includes("チーム名"))
  );

  const fetchedAt = new Date().toISOString();
  if (!targetTable) {
    return { eventId, total: announced ?? 0, teams: [], fetchedAt };
  }

  // 行パース
  const rows: EntryRow[] = [];
  $(targetTable)
    .find("tr")
    .each((_, tr) => {
      const td = $(tr).find("td");
      if (td.length < 3) return; // ヘッダ行や不正行をスキップ
      const className = $(td[0]).text().trim();
      const name = $(td[1]).text().replace(/\s+/g, " ").trim();
      const affiliation = $(td[2]).text().trim();
      const memRaw = td.length >= 4 ? $(td[3]).text().trim() : "";
      const members = memRaw && memRaw !== "-" ? memRaw : undefined;
      if (!className && !name) return;
      rows.push({ className, name, affiliation, members });
    });

  // 所属でグループ化（複数所属は分割して両方に計上）
  const map = new Map<string, EntryRow[]>();
  for (const row of rows) {
    const clubs = splitAffiliations(row.affiliation);
    const keys = clubs.length > 0 ? clubs : [NO_AFFILIATION];
    for (const key of keys) {
      const list = map.get(key);
      if (list) list.push(row);
      else map.set(key, [row]);
    }
  }

  const teams: TeamGroup[] = [...map.entries()]
    .map(([affiliation, entries]) => ({ affiliation, count: entries.length, entries }))
    .sort(
      (a, b) => b.count - a.count || a.affiliation.localeCompare(b.affiliation, "ja")
    );

  // total は実エントリー件数（ユニーク人数）。リストが取れない場合のみ公称値を使う
  const total = rows.length > 0 ? rows.length : announced ?? 0;

  return { eventId, total, teams, fetchedAt };
}

/**
 * JOY大会詳細ページ（/event/view/{id}/show_detail）を取得してエントリーリストを返す。
 * 上流HTMLは1時間キャッシュ（Hobby 10秒制限内・JOY負荷軽減）。
 */
export async function scrapeEntryList(
  eventId: number,
  opts: { signal?: AbortSignal; throwOnError?: boolean } = {},
): Promise<EntryListResult> {
  const url = `${BASE_URL}/event/view/${eventId}/show_detail`;
  const res = await fetch(url, {
    headers: { "User-Agent": "trails.jp/1.0 (entry list)" },
    next: { revalidate: 3600 },
    signal: opts.signal,
  });
  if (!res.ok) {
    // 集計バッチ(cron)では「取得失敗」と「真に空」を区別する必要があるため throw。
    // オンデマンドAPI(既存)は throwOnError 未指定 → 従来どおり空を返してグレースフルに継続。
    if (opts.throwOnError) {
      throw new Error(`entry fetch failed: ${res.status} (event ${eventId})`);
    }
    return { eventId, total: 0, teams: [], fetchedAt: new Date().toISOString() };
  }
  const html = await res.text();
  return parseEntryList(html, eventId);
}
