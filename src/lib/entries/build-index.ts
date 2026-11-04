/**
 * 選手別エントリーインデックスの構築。
 * 対象大会のエントリーリストを並列スクレイプし、氏名(スペース除去)キーで集計する。
 * sync-entries cron から呼ばれる。Vercel Hobby の10秒関数制限に収めるため、
 * 連続供給型の並列プール + 全体ウォールクロック予算（超過時は in-flight も abort）で
 * 経過時間を上限付きに保つ。予算切れ時は部分結果を返す（scrapedEventCount に反映）。
 */
import type { JOEEvent } from "@/lib/scraper/events";
import { scrapeEntryListByEventId } from "@/lib/scraper/entry-source";
import { normalizeNameKey, expandAliasKeys } from "@/lib/name-key";
import { resolveAliasName } from "@/lib/identity/athlete-alias";
import type { AthleteEntryRef, EntryIndex } from "./index-types";
import entrySeedsJson from "@/data/entry-seeds.json";

/**
 * リレー等の「メンバー」欄から個人名を抽出する。
 * 例: "(福田雅秀 - 大林俊彦)" → ["福田雅秀", "大林俊彦"]。
 * 区切りは " - "(ハイフン両側に空白) / 読点 / カンマ / スラッシュ。中黒(・)は氏名内にも使うため区切りにしない。
 * 妥当でないトークン（記号のみ・極端に長い等）は捨てる。索引は追加のみなので取りこぼしても無害。
 */
function parseRelayMembers(raw: string): string[] {
  const stripped = raw
    .trim()
    .replace(/^[（(【\[]+/, "")
    .replace(/[）)】\]]+$/, "")
    .trim();
  if (!stripped) return [];
  const out: string[] = [];
  for (const part of stripped.split(/\s+-\s+|[,、，/／]/)) {
    const n = part.trim();
    if (!n || n.length > 20) continue;
    if (!/\p{L}/u.test(n)) continue; // 文字（漢字/かな/英字）を含まないトークンは除外
    out.push(n);
  }
  return out;
}

interface BuildOpts {
  /** 同時スクレイプ数 */
  concurrency?: number;
  /** 1大会あたりのタイムアウト(ms) */
  perEventTimeoutMs?: number;
  /** スクレイプ全体のウォールクロック予算(ms)。超過後は新規開始も in-flight も打ち切る。 */
  overallBudgetMs?: number;
  /** 持ち越し用の seed（既定は src/data/entry-seeds.json）。テストで差し替える */
  seeds?: EntrySeeds;
}

interface ScrapedEvent {
  ev: JOEEvent;
  total: number;
  /** 氏名+クラスで重複排除済みの生エントリー（複数所属の二重計上を排除） */
  rows: { className: string; name: string; affiliation: string }[];
}

/** 1大会をタイムアウト付きでスクレイプ。失敗・タイムアウト・abort は null（スキップ）。 */
async function scrapeOne(ev: JOEEvent, timeoutMs: number): Promise<ScrapedEvent | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // throwOnError: 非2xx(403/500等)を「失敗」として throw させ、空データとして集計しない。
    // → catch で null を返し scraped に数えない（古い良いインデックスを空で潰さない）。
    // ev.joe_event_id が どこオリの合成ID（DOKORI_ID_BASE 以上）なら どこオリ から取得。
    // それ以外は従来どおり JOY。索引化以降のロジックはソース非依存で共通。
    const result = await scrapeEntryListByEventId(ev.joe_event_id, {
      signal: controller.signal,
      throwOnError: true,
    });
    // teams は所属別グループ（複数所属は二重計上）。氏名+クラスで重複排除して生エントリーに戻す。
    const seen = new Set<string>();
    const rows: ScrapedEvent["rows"] = [];
    for (const team of result.teams) {
      for (const row of team.entries) {
        if (!row.className) continue; // クラス欠落の不正行は除外

        // チーム名(個人なら本人名、リレーならチーム名)。従来挙動を保つため索引に追加する。
        const teamAlias = resolveAliasName(row.name, [row.affiliation]);
        const teamName = teamAlias.kind === "renamed" ? teamAlias.name : row.name;
        const teamKey = normalizeNameKey(teamName);
        if (teamKey) {
          const dedupeKey = `${teamKey}|${row.className}`;
          if (!seen.has(dedupeKey)) {
            seen.add(dedupeKey);
            rows.push({ className: row.className, name: teamName, affiliation: row.affiliation });
          }
        }

        // リレー等: メンバー欄の個人を本人名で索引する（チーム名キーは個人ページから引かれないため）。
        if (row.members) {
          for (const member of parseRelayMembers(row.members)) {
            const memberAlias = resolveAliasName(member, [row.affiliation]);
            const memberName = memberAlias.kind === "renamed" ? memberAlias.name : member;
            const mKey = normalizeNameKey(memberName);
            if (!mKey) continue;
            const mDedupe = `${mKey}|${row.className}`;
            if (seen.has(mDedupe)) continue;
            seen.add(mDedupe);
            rows.push({ className: row.className, name: memberName, affiliation: row.affiliation });
          }
        }
      }
    }
    return { ev, total: result.total, rows };
  } catch {
    return null; // abort / fetch error → スキップ
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 対象大会群から選手別エントリーインデックスを生成する。
 */
export async function buildEntryIndex(
  targetEvents: JOEEvent[],
  opts: BuildOpts = {},
  /** 前回の索引。エントリー表が取れなくなった大会の持ち越しに使う（無ければ持ち越さない） */
  prevIndex?: EntryIndex | null,
): Promise<EntryIndex> {
  const concurrency = opts.concurrency ?? 8;
  const perEventTimeoutMs = opts.perEventTimeoutMs ?? 3500;
  // 予算超過後も in-flight ワーカーの「fetch後の同期パース(cheerio)」は中断できないため、
  // 6.5秒に抑えてパース末尾 + readEvents/writeEntryIndex/直列化のための余白(~3.5秒)を10秒制限内に残す。
  const overallBudgetMs = opts.overallBudgetMs ?? 6500;
  const startedAt = Date.now();

  const athletes: Record<string, AthleteEntryRef[]> = {};
  const scrapedEventIds: number[] = [];
  const emptyEvents: EmptyEvent[] = [];
  let scraped = 0;
  let nextIdx = 0;

  const ingest = (s: ScrapedEvent): void => {
    scraped++;
    const { ev, total, rows } = s;
    scrapedEventIds.push(ev.joe_event_id); // エントリー0件(ロゲイニング/講習等)もフェッチ成功として記録
    if (rows.length === 0) emptyEvents.push({ ev, announced: total });
    const entryStatus = ev.entry_status; // "open" | "closed" | "none"（そのまま保持）
    for (const row of rows) {
      const alias = resolveAliasName(row.name, [row.affiliation]);
      const athleteName = alias.kind === "renamed" ? alias.name : row.name;
      const baseKey = normalizeNameKey(athleteName);
      if (!baseKey) continue; // scrapeOne 側で保証済みだが念のため空キー除外
      const ref: AthleteEntryRef = {
        joe_event_id: ev.joe_event_id,
        eventName: ev.name,
        date: ev.date,
        prefecture: ev.prefecture,
        className: row.className,
        affiliation: row.affiliation,
        entryStatus,
        joeUrl: ev.joe_url,
        totalEntries: total,
      };
      // 別名（旧姓⇄新姓等）があれば両方のキーで索引（選手マスタ側の表記でも引けるように）。
      // 別名が無ければ [baseKey] のみ＝従来挙動。
      for (const key of expandAliasKeys(baseKey)) {
        (athletes[key] ??= []).push(ref);
      }
    }
  };

  // 連続供給型の並列プール: 各ワーカーは予算が残る限り次の大会を引き取る。
  // 各スクレイプの実効タイムアウトは min(perEventTimeout, 残り予算) で、
  // 予算到達時に in-flight も abort される → 全体経過 ≈ overallBudgetMs に収まる。
  async function worker(): Promise<void> {
    for (;;) {
      const remaining = overallBudgetMs - (Date.now() - startedAt);
      if (remaining <= 200) return; // 予算ほぼ消化 → 新規開始しない
      const i = nextIdx++; // 単一スレッドJS: read→++ の間に await が無いため lock 不要
      if (i >= targetEvents.length) return;
      const ev = targetEvents[i];
      let result = await scrapeOne(ev, Math.min(perEventTimeoutMs, remaining));
      if (!result) {
        // transient な JOY エラー(403/500/timeout)で取りこぼさないよう1回だけ即リトライ（予算が残れば）
        const rem2 = overallBudgetMs - (Date.now() - startedAt);
        if (rem2 > 400) result = await scrapeOne(ev, Math.min(perEventTimeoutMs, rem2));
      }
      if (result) ingest(result);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, targetEvents.length) },
    () => worker(),
  );
  await Promise.all(workers);

  const carriedEventIds = carryOverHiddenEvents(
    athletes,
    emptyEvents,
    prevIndex ?? null,
    opts.seeds ?? (entrySeedsJson as unknown as EntrySeeds),
  );

  // 各選手のエントリーを date 昇順（同日は大会名）でソート
  for (const key of Object.keys(athletes)) {
    athletes[key].sort(
      (a, b) => a.date.localeCompare(b.date) || a.eventName.localeCompare(b.eventName),
    );
  }

  return {
    generatedAt: new Date().toISOString(),
    targetEventCount: targetEvents.length,
    scrapedEventCount: scraped,
    scrapedEventIds,
    carriedEventIds,
    athletes,
  };
}

/** フェッチには成功したがエントリー行が0件だった大会（ev と公称人数） */
interface EmptyEvent {
  ev: JOEEvent;
  announced: number;
}

/**
 * エントリー表が取れなかった大会について、前回索引のエントリーを引き継ぐ（athletes を更新する）。
 *
 * JOY は主催者がエントリーリストを非公開にすると show_detail から表が消え、「N 人が申込済」だけになる
 * （2026-10-28 伊豆大島大会2026 で実測）。そのまま作り直すと、その大会のエントリーが全選手から消える。
 * → 今回0行・前回1件以上の大会は、前回のエントリーを carriedOver 付きで残す。
 * 大会名・日付・受付状態・公称人数は今回の大会情報で更新する。大会が期間外・中止になれば targets から
 * 外れて emptyEvents に入らないので、自然に消える。取得失敗（null）の大会は従来どおり対象外。
 * 前回索引は別名キーに展開済みなので、キーごとにそのまま写せば別名の重複も増えない。
 */
function carryOverHiddenEvents(
  athletes: Record<string, AthleteEntryRef[]>,
  emptyEvents: EmptyEvent[],
  prevIndex: EntryIndex | null,
  seeds: EntrySeeds,
): number[] {
  if (emptyEvents.length === 0) return [];
  const byId = new Map(emptyEvents.map((e) => [e.ev.joe_event_id, e]));
  const carried = new Set<number>();
  for (const [key, refs] of Object.entries(prevIndex?.athletes ?? {})) {
    for (const ref of refs) {
      const empty = byId.get(ref.joe_event_id);
      if (!empty) continue;
      const { ev, announced } = empty;
      (athletes[key] ??= []).push({
        ...ref,
        eventName: ev.name,
        date: ev.date,
        prefecture: ev.prefecture,
        entryStatus: ev.entry_status,
        joeUrl: ev.joe_url,
        totalEntries: announced > 0 ? announced : ref.totalEntries,
        carriedOver: true,
      });
      carried.add(ref.joe_event_id);
    }
  }
  // 前回索引にも無い（非公開化より前に索引が上書きされてしまった）大会は、主催者リストの seed で補う
  for (const { ev, announced } of emptyEvents) {
    if (carried.has(ev.joe_event_id)) continue;
    const seed = seeds[String(ev.joe_event_id)];
    if (!seed || seed.rows.length === 0) continue;
    const seen = new Set<string>();
    for (const row of seed.rows) {
      const alias = resolveAliasName(row.name, [row.affiliation]);
      const name = alias.kind === "renamed" ? alias.name : row.name;
      const baseKey = normalizeNameKey(name);
      if (!baseKey || !row.className || seen.has(`${baseKey}|${row.className}`)) continue;
      seen.add(`${baseKey}|${row.className}`);
      const ref: AthleteEntryRef = {
        joe_event_id: ev.joe_event_id,
        eventName: ev.name,
        date: ev.date,
        prefecture: ev.prefecture,
        className: row.className,
        affiliation: row.affiliation,
        entryStatus: ev.entry_status,
        joeUrl: ev.joe_url,
        totalEntries: announced > 0 ? announced : seed.rows.length,
        carriedOver: true,
      };
      for (const key of expandAliasKeys(baseKey)) (athletes[key] ??= []).push(ref);
    }
    carried.add(ev.joe_event_id);
  }
  return [...carried].sort((a, b) => a - b);
}

/** 主催者サイト等から手で取り込んだエントリー（JOY で取れなくなった大会の補い）。キーは joe_event_id */
export type EntrySeeds = Record<
  string,
  { rows: { name: string; className: string; affiliation: string }[] }
>;
