/**
 * スタートリスト取込 API（配車割 Phase 4）の zod スキーマ。
 *
 * 既存 schemas.ts の actorName / timeString を再利用し、import-startlist ルート専用の
 * リクエスト body 契約を定義する。url と pastedText は一方のみ（refine）。
 */

import { z } from "zod";
import { actorName, timeString } from "./schemas";

/** 貼り付けテキストの上限（PDF 全文相当。極端な巨大入力を弾く）。 */
const PASTED_TEXT_MAX = 200_000;

/**
 * apply=true（反映）時に UI で編集された値を memberId 単位で上書きする。
 * startTime / className は明示 null でクリア、未指定（undefined）なら match 値を使う。
 */
const startlistOverride = z.object({
  memberId: z.string().uuid(),
  startTime: timeString.nullable().optional(),
  className: z.string().trim().max(40).nullable().optional(),
});

/**
 * POST /import-startlist の body。
 *  - url か pastedText のどちらか一方を必須（両方/両方不在は 400）。
 *  - apply: false = プレビュー（突合のみ・書込みなし） / true = participation へ反映。
 *  - overrides: 反映時のユーザー編集値（任意）。
 */
export const importStartlistSchema = z
  .object({
    actorName,
    url: z.string().url({ message: "URL の形式が不正です" }).optional(),
    pastedText: z
      .string()
      .max(PASTED_TEXT_MAX, { message: "貼り付けテキストが大きすぎます" })
      .optional(),
    apply: z.boolean(),
    overrides: z.array(startlistOverride).max(500).optional(),
  })
  .refine((b) => (b.url != null) !== (b.pastedText != null), {
    message: "URL か貼り付けテキストのいずれか一方を指定してください",
    path: ["url"],
  });

export type ImportStartlistInput = z.infer<typeof importStartlistSchema>;
export type StartlistOverride = z.infer<typeof startlistOverride>;
