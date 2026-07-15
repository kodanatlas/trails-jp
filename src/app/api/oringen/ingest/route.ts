import { NextResponse } from "next/server";
import { readOringenStrict, writeOringen } from "@/lib/oringen-store";
import { oringenDataSchema } from "@/lib/oringen/schema";
import { assessQuality } from "@/lib/oringen/quality";
import { logCron } from "@/lib/cron-logger";
import { notifyCronWarning } from "@/lib/cron-notifier";
import type { OringenData } from "@/lib/oringen/types";

/**
 * O-Ringen 日本勢データの受け口。**取得はしない。検証して保存するだけ。**
 *
 * 重い取得（189クラス×5日 = 45秒/27MB）は GitHub Actions の runner が担う。
 * Vercel Hobby の関数は 60 秒上限で、既存 sync-entries が同じ形で 504 を起こしエントリー索引を
 * 凍結させた実績があるため（docs/plans/2026-07-12_lc_card_and_sync_entries_incident.md）、
 * ここには取得を持ち込まない。この route は Storage への薄い書き込みゲートウェイに徹する。
 *
 * 呼び出し元: .github/workflows/sync-oringen.yml → scripts/fetch-oringen.ts
 */

const JOB = "sync-oringen";

// 取得を持たないので既定(短い)で足りる。zod 検証 + Storage write 1回のみ。
export const maxDuration = 30;

/** 暴走ペイロード対策。日本勢50名で ~150KB なので十分な余裕を取りつつ青天井にしない。 */
const MAX_PAYLOAD_BYTES = 2_000_000;

export async function POST(request: Request) {
  const start = Date.now();

  // 既存 cron の CRON_SECRET は流用しない（権限を分離する）。
  const secret = process.env.ORINGEN_INGEST_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "ORINGEN_INGEST_SECRET not configured" }, { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > MAX_PAYLOAD_BYTES) {
      return NextResponse.json(
        { error: "payload too large", bytes: contentLength, max: MAX_PAYLOAD_BYTES },
        { status: 413 },
      );
    }

    const raw = await request.text();
    if (raw.length > MAX_PAYLOAD_BYTES) {
      // content-length を偽られた場合の保険
      return NextResponse.json(
        { error: "payload too large", bytes: raw.length, max: MAX_PAYLOAD_BYTES },
        { status: 413 },
      );
    }

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
    }

    // 形式検証。**これは形しか見ない**（中身の劣化は下の品質ガードが弾く）。
    // strictObject なので、生年など想定外のキーが混入すれば unrecognized_keys で落ちる。
    const parsed = oringenDataSchema.safeParse(json);
    if (!parsed.success) {
      const issues = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`);
      await logCron(JOB, "error", { error: "schema_invalid", issues }, Date.now() - start);
      return NextResponse.json({ error: "schema invalid", issues }, { status: 400 });
    }
    const next = parsed.data as OringenData;

    // 劣化判定の「前回値」。読めなければ null = 初回扱い。
    // ここでバンドルのスナップショットにフォールバックすると、Storage 障害時に「前回=古いバンドル」との
    // 比較になって劣化を見逃すため、readOringenStrict（fail-closed）を使う。
    const prev = await readOringenStrict();
    const assessment = assessQuality(prev, next);

    if (!assessment.ok) {
      // **拒否＝既存の正常データを保持**。壊れた更新より古い正確なデータを出す。
      await logCron(
        JOB,
        "error",
        { error: "quality_blocked", reason: assessment.reason, ...assessment.detail },
        Date.now() - start,
      );
      await notifyCronWarning(
        JOB,
        `quality_blocked:${assessment.reason}`,
        {
          warning: "quality_blocked",
          reason: assessment.reason,
          ...assessment.detail,
          hint:
            "O-Ringen データの上書きを劣化として拒否。既存データは保持。" +
            "too_few_people/people_regression=クラス取得の部分失敗, " +
            "confirmed_starts_regression=st フィールドの仕様変更疑い, " +
            "stale_generated_at=リトライ/並行実行の順序逆転, " +
            "event_id_mismatch=別大会のペイロード。",
        },
        Date.now() - start,
      );
      // HTTP 200 + success:false は entry-index-backstop.yml と同じ規約。
      // 200 だけ見て緑と誤認する事故を防ぐため、workflow 側は本文の success を必ず見る。
      return NextResponse.json(
        { success: false, blocked: assessment.reason, ...assessment.detail },
        { status: 200 },
      );
    }

    await writeOringen(next);

    const payload = {
      success: true,
      people: assessment.detail.nextPeople,
      confirmedStarts: assessment.detail.nextConfirmed,
      generatedAt: next.generatedAt,
      durationMs: Date.now() - start,
    };
    await logCron(JOB, "success", payload, Date.now() - start);
    return NextResponse.json(payload);
  } catch (error) {
    console.error("O-Ringen ingest failed:", error);
    await logCron(JOB, "error", { error: String(error) }, Date.now() - start);
    return NextResponse.json({ error: "ingest failed" }, { status: 500 });
  }
}
