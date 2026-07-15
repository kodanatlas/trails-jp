import { z } from "zod";

/**
 * ingest ペイロードの形式検証。
 *
 * **形しか見ない。** 「50人が10人になった」等の中身の劣化は quality.ts が別途弾く。
 * ここを通っても安全ではない、という前提で ingest を書くこと。
 *
 * **全て strictObject にしている**（未知のキーを捨てずにエラーにする）。理由:
 * `z.object` は未知のキーを**黙って捨てる**ため、「生年が混入していないこと」を superRefine で
 * 検証しようとしても、その時点では既にキーが剥がされていて検証が素通りする（2026-07-15 に実測）。
 * 剥がされる＝データは安全だが、**上流（scripts/fetch-oringen.ts）が生年を送り始めても気づけない**。
 * strict なら `unrecognized_keys: birthYear` として 400 で落ち、上流の退行が可視化される。
 */

const entrySchema = z.strictObject({
  className: z.string().min(1).max(64),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  place: z.number().int().positive().nullable(),
  time: z.string().regex(/^\d+:\d{2}:\d{2}$/).nullable(),
  distanceM: z.number().nonnegative().nullable(),
});

/**
 * 生年（birthYear / by）は**意図的に持たない**。O-Ringen 自身が画面に出していない値を、
 * 検索エンジンに載る公開サイトが API から掘り起こして再掲する理由がないため（2026-07-15 ユーザー判断）。
 * strictObject なので、混入すれば unrecognized_keys で 400 になる。
 */
const personSchema = z.strictObject({
  name: z.string().min(1).max(128),
  kanji: z.string().min(1).max(64).nullable(),
  kanjiConfidence: z.enum(["high", "medium"]).nullable(),
  club: z.string().max(128),
  // stage は "1"〜"5"
  entries: z.record(z.string().regex(/^[1-5]$/), z.array(entrySchema).max(8)),
});

const raceSchema = z.strictObject({
  n: z.number().int().min(1).max(5),
  raceId: z.number().int().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const oringenDataSchema = z.strictObject({
  generatedAt: z.iso.datetime({ offset: true }),
  eventId: z.number().int().positive(),
  eventName: z.string().min(1).max(128),
  resultUrl: z.url(),
  races: z.array(raceSchema).min(1).max(5),
  // 上限は暴走ペイロード対策。日本勢50名に対し十分な余裕を取りつつ青天井にしない
  people: z.array(personSchema).max(300),
  links: z.strictObject({
    official: z.url(),
    eventor: z.url().nullable(),
    livelox: z.url().nullable(),
    winsplits: z.url().nullable(),
  }),
});
