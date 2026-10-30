import type { EntryListResult } from "@/lib/scraper/entries";

/** 1回目の失敗後、再試行までの待ち時間（ms） */
const RETRY_DELAY_MS = 1500;

type Fetcher = (url: string) => Promise<Response>;

/**
 * エントリーリストAPIを1回叩く。非2xx・非JSON（504 の HTML 等）・API側の `error` 付き応答は失敗として throw する。
 * API は上流取得失敗時に 200 + `error: "fetch_failed"` を返すため、ok だけでは判定できない。
 */
async function fetchOnce(eventId: number, fetcher: Fetcher): Promise<EntryListResult> {
  const res = await fetcher(`/api/events/${eventId}/entries`);
  if (!res.ok) throw new Error(`entries API ${res.status} (event ${eventId})`);
  const data = (await res.json()) as EntryListResult & { error?: string };
  if (data.error) throw new Error(`entries API error: ${data.error} (event ${eventId})`);
  const wellFormed =
    typeof data.total === "number" &&
    Array.isArray(data.teams) &&
    data.teams.every((t) => t !== null && typeof t === "object" && Array.isArray(t.entries));
  if (!wellFormed) {
    throw new Error(`entries API malformed response (event ${eventId})`);
  }
  return data;
}

/**
 * エントリーリストを取得する。上流（JOY）の一時的な遅延や回線断で1回失敗しても、
 * 少し待って1度だけ取り直す。2回とも失敗したら throw（呼び出し側で「再読み込み」を出す）。
 */
export async function fetchEntryList(
  eventId: number,
  opts: { fetcher?: Fetcher; retryDelayMs?: number } = {},
): Promise<EntryListResult> {
  const fetcher = opts.fetcher ?? ((url: string) => fetch(url));
  try {
    return await fetchOnce(eventId, fetcher);
  } catch {
    await new Promise((resolve) => setTimeout(resolve, opts.retryDelayMs ?? RETRY_DELAY_MS));
    return fetchOnce(eventId, fetcher);
  }
}
