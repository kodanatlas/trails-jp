/**
 * どこオリ (dokori.net) 大会ページのスクレイパ。
 *
 * どこオリは Next.js (App Router / RSC) アプリで、公開イベントページは全データを
 * React Server Component の "flight" ペイロード
 *   <script>self.__next_f.push([N,"...escaped..."])</script>
 * に server-render する。各 push の文字列を unescape して連結すると、クリーンな
 * JSON 断片を含む ~300KB のテキスト（flight）が得られる。ここからエントリー一覧と
 * 大会メタデータを抽出し、JOY スクレイパと同じ出力契約（EntryListResult / JOEEvent）
 * に整形して、アプリの他の部分を変更せずに使えるようにする。
 */
import { splitAffiliations } from "@/lib/club-normalize";
import { normalizeNameKey } from "@/lib/name-key";
import type { JOEEvent } from "./events";
import type { EntryListResult, EntryRow, TeamGroup } from "./entries";

export const DOKORI_BASE_URL = "https://www.dokori.net";

/** どこオリ用の合成イベントID予約レンジ（JOYの整数IDと衝突させない）。 */
export const DOKORI_ID_BASE = 90_000_000;

const NO_AFFILIATION = "所属なし";

export interface DokoriRegistryEntry {
  publicId: string;
  eventId: number;
}

/** ホワイトリスト（取り込む対象はここに登録した大会のみ）。 */
export const DOKORI_EVENTS: DokoriRegistryEntry[] = [
  { publicId: "evt_tortoise_50th", eventId: DOKORI_ID_BASE + 1 },
];

export function isDokoriEventId(id: number): boolean {
  return id >= DOKORI_ID_BASE;
}

export function getDokoriPublicId(eventId: number): string | null {
  return DOKORI_EVENTS.find((e) => e.eventId === eventId)?.publicId ?? null;
}

/**
 * HTML から RSC flight ペイロードを復元する。
 * `self.__next_f.push([N,"..."])` の各文字列を JSON unescape して連結する。
 * （tests から呼ぶため export）
 */
export function reconstructFlight(html: string): string {
  const re = /self\.__next_f\.push\(\[\d+,\s*"((?:[^"\\]|\\.)*)"\]\)/g;
  let m: RegExpExecArray | null;
  let flight = "";
  while ((m = re.exec(html)) !== null) {
    try {
      flight += JSON.parse('"' + m[1] + '"');
    } catch {
      flight += m[1];
    }
  }
  return flight;
}

interface DokoriEntrant {
  name: string;
  classes: string[];
  status: string;
  club: string | null;
}

/** flight 文字列から entrant オブジェクトを抽出し、name+classes+status で重複排除する。 */
function extractEntrants(flight: string): DokoriEntrant[] {
  const entRe =
    /\{"name":"(?:[^"\\]|\\.)*","classes":\[[^\]]*\],"status":"[^"]*","club":(?:"(?:[^"\\]|\\.)*"|\$undefined|null)\}/g;
  const seen = new Set<string>();
  const entrants: DokoriEntrant[] = [];
  let m: RegExpExecArray | null;
  while ((m = entRe.exec(flight)) !== null) {
    // RSC リテラル $undefined（クォート有無の両形）を null に置換してから JSON.parse。
    const raw = m[0]
      .replace(/"\$undefined"/g, "null")
      .replace(/:\$undefined/g, ":null");
    let obj: DokoriEntrant;
    try {
      obj = JSON.parse(raw) as DokoriEntrant;
    } catch {
      continue;
    }
    const classes = Array.isArray(obj.classes) ? obj.classes : [];
    const key = `${obj.name}|${classes.join(",")}|${obj.status}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entrants.push({
      name: obj.name,
      classes,
      status: obj.status,
      club: obj.club == null ? null : obj.club,
    });
  }
  return entrants;
}

/** confirmed / pending_payment のみ有効（cancelled 等は除外）。 */
function isValidStatus(status: string): boolean {
  return status === "confirmed" || status === "pending_payment";
}

/**
 * どこオリ大会ページのHTMLからエントリー一覧を抽出し、所属（クラブ）単位でグループ化する。
 * 複数所属は分割して各クラブに計上（JOY の parseEntryList と同じ二重計上）。純関数。
 */
export function parseDokoriEntryList(html: string, eventId: number): EntryListResult {
  const flight = reconstructFlight(html);
  const fetchedAt = new Date().toISOString();

  const entrants = extractEntrants(flight).filter((e) => isValidStatus(e.status));

  // 各 entrant の各クラスごとに1行（マルチクラスは複数行）。
  const rows: EntryRow[] = [];
  for (const ent of entrants) {
    const classes = ent.classes.length > 0 ? ent.classes : [""];
    for (const className of classes) {
      rows.push({
        className,
        name: ent.name,
        affiliation: ent.club ?? "",
      });
    }
  }

  // 所属でグループ化（複数所属は分割して両方に計上）。
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
      (a, b) => b.count - a.count || a.affiliation.localeCompare(b.affiliation, "ja"),
    );

  // total はユニーク人数（氏名の正準キーで重複排除）。行数でも team count の総和でもない。
  const persons = new Set<string>();
  for (const ent of entrants) persons.add(normalizeNameKey(ent.name));
  const total = persons.size;

  return { eventId, total, teams, fetchedAt };
}

// --- 大会メタデータ ---

interface DokoriDay {
  date?: string;
  raceDistance?: string;
  label?: string;
  terrainName?: string;
  location?: string;
  venueName?: string;
  venueGeo?: { lat?: number; lng?: number } | null;
}

/** flight から `"days":[...]` をバランス括弧で切り出して JSON.parse する。 */
function extractDays(flight: string): DokoriDay[] {
  const marker = '"days":[';
  const markerIdx = flight.indexOf(marker);
  if (markerIdx < 0) return [];
  const start = flight.indexOf("[", markerIdx);
  if (start < 0) return [];
  let depth = 0;
  let end = -1;
  for (let i = start; i < flight.length; i++) {
    const ch = flight[i];
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) return [];
  const raw = flight.slice(start, end + 1);
  // RSC リテラル参照（$undefined, $123 等）を null に置換してから parse。
  const json = raw.replace(/:\s*\$[A-Za-z0-9_]+/g, ":null");
  try {
    const days = JSON.parse(json) as DokoriDay[];
    return Array.isArray(days) ? days : [];
  } catch {
    return [];
  }
}

/** 申込締切（ISO 日時）を flight から抽出。日時形のみを採用（UIラベルを誤取得しないため）。 */
function extractDeadlineMs(flight: string): number | null {
  // 優先: クリーンな ISO 形 "deadline":"2026-09-05T03:00:00+09:00"
  const isoDeadline = flight.match(/"deadline":"(\d{4}-\d{2}-\d{2}T[^"]*)"/);
  if (isoDeadline) {
    const ms = Date.parse(isoDeadline[1]);
    if (!Number.isNaN(ms)) return ms;
  }
  // 代替: "registrationDeadline":"2026-09-04 18:00:00+00"（同一インスタント）
  const reg = flight.match(/"registrationDeadline":"(\d{4}-\d{2}-\d{2}[^"]*)"/);
  if (reg) {
    const ms = Date.parse(reg[1].replace(" ", "T"));
    if (!Number.isNaN(ms)) return ms;
  }
  return null;
}

/** <title> から ` | どこオリ` を除いた大会名を取得。 */
function extractTitle(html: string): string {
  const m = html.match(/<title>([^<]*)<\/title>/i);
  if (!m) return "";
  return m[1].replace(/\s*\|\s*どこオリ\s*$/, "").trim();
}

type DokoriJOEEvent = JOEEvent & {
  source?: "joy" | "dokori";
  dokori_public_id?: string;
};

/**
 * どこオリ大会ページのHTMLから JOEEvent を生成する。純関数。
 */
export function parseDokoriEvent(
  html: string,
  publicId: string,
  eventId: number,
  now: number = Date.now(),
): JOEEvent {
  const flight = reconstructFlight(html);
  const days = extractDays(flight);
  const dates = days.map((d) => d.date).filter((d): d is string => !!d).sort();
  const date = dates[0] ?? "";
  const lastDate = dates[dates.length - 1] ?? "";
  const end_date = lastDate && lastDate !== date ? lastDate : undefined;

  const first = days[0];
  const location = first?.location ?? "";
  const prefMatch = location.match(/^(.+?[都道府県])/);
  const prefecture = prefMatch ? prefMatch[1] : location;

  const venue = first?.venueName ?? first?.terrainName ?? first?.location ?? undefined;

  let lat: number | null = null;
  let lng: number | null = null;
  const geo = first?.venueGeo;
  if (geo && typeof geo.lat === "number" && typeof geo.lng === "number") {
    if (geo.lat >= 20 && geo.lat <= 50 && geo.lng >= 120 && geo.lng <= 155) {
      lat = geo.lat;
      lng = geo.lng;
    }
  }

  const deadlineMs = extractDeadlineMs(flight);
  const entry_status: JOEEvent["entry_status"] =
    deadlineMs === null ? "none" : now < deadlineMs ? "open" : "closed";

  const event: DokoriJOEEvent = {
    joe_event_id: eventId,
    name: extractTitle(html),
    date,
    end_date,
    event_type: first?.raceDistance,
    prefecture,
    venue,
    entry_status,
    tags: ["どこオリ"],
    joe_url: `${DOKORI_BASE_URL}/event/${publicId}`,
    lat,
    lng,
    source: "dokori",
    dokori_public_id: publicId,
  };
  return event;
}

// --- ネットワーク ---

const ENTRY_UA = "trails.jp/1.0 (dokori entry list)";
const EVENT_UA = "trails.jp/1.0 (dokori event sync)";

/**
 * どこオリ大会ページを取得してエントリー一覧を返す。
 * 上流HTMLは1時間キャッシュ。throwOnError の意味論は scrapeEntryList と同一
 * （cron では取得失敗と真の空を区別するため throw、オンデマンドは空を返してグレースフル継続）。
 */
export async function scrapeDokoriEntryList(
  eventId: number,
  opts: { signal?: AbortSignal; throwOnError?: boolean } = {},
): Promise<EntryListResult> {
  const publicId = getDokoriPublicId(eventId);
  const emptyResult = (): EntryListResult => ({
    eventId,
    total: 0,
    teams: [],
    fetchedAt: new Date().toISOString(),
  });

  if (!publicId) {
    if (opts.throwOnError) {
      throw new Error(`unknown dokori event id: ${eventId}`);
    }
    return emptyResult();
  }

  const res = await fetch(`${DOKORI_BASE_URL}/event/${publicId}`, {
    headers: { "User-Agent": ENTRY_UA },
    next: { revalidate: 3600 },
    signal: opts.signal,
  });
  if (!res.ok) {
    if (opts.throwOnError) {
      throw new Error(`dokori entry fetch failed: ${res.status} (event ${eventId})`);
    }
    return emptyResult();
  }
  const html = await res.text();
  return parseDokoriEntryList(html, eventId);
}

/**
 * ホワイトリスト（DOKORI_EVENTS）の各大会ページを取得して JOEEvent[] を返す。
 * 1件の失敗がバッチ全体を落とさないよう、イベント単位で try/catch して skip する。
 */
export async function scrapeDokoriEvents(
  opts: { signal?: AbortSignal } = {},
): Promise<JOEEvent[]> {
  const events: JOEEvent[] = [];
  for (const entry of DOKORI_EVENTS) {
    try {
      const res = await fetch(`${DOKORI_BASE_URL}/event/${entry.publicId}`, {
        headers: { "User-Agent": EVENT_UA },
        next: { revalidate: 0 },
        signal: opts.signal,
      });
      if (!res.ok) continue;
      const html = await res.text();
      events.push(parseDokoriEvent(html, entry.publicId, entry.eventId));
    } catch {
      // イベント単位で隔離: 1件の失敗で他を巻き込まない。
      continue;
    }
  }
  return events;
}
