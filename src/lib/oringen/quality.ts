import type { OringenData } from "./types";
import { countConfirmedStarts } from "./normalize";

/**
 * `oringen-2026.json` の「劣化上書き」検知。純関数・決定的（外部依存なし）。
 *
 * ingest は外部（GitHub Actions）から POST されたペイロードで Storage を**上書き**する。
 * 未文書 API の仕様変更・部分取得・runner 側の一時障害で「形式は正しいが中身が壊れた」ペイロードが
 * 届きうる。zod は形しか見ないので、それだけでは以下を防げない:
 *
 *   - 50人が10人になった（クラス取得の部分失敗）
 *   - startTime が全部消えた（API の st フィールド仕様変更）
 *   - 古い generatedAt で新しいデータを上書き（リトライ/並行実行の順序逆転）
 *
 * `src/lib/entries/index-quality.ts` と同じ fail-closed 思想。**拒否＝前回の正常データを保持**する。
 * 壊れた更新より、古いが正確なデータを出す方がマシ。
 *
 * O-Ringen 特有の事情として、entry-index と違い**人数はカレンダーで自然増減しない**（エントリー締切済み・
 * 名簿は確定）。よって index-quality のような per-event 中和は不要で、単純な下限＋前回比で判定できる。
 */

export interface QualityOpts {
  /** 既知ロスターの人数。これを下回ったら拒否 */
  minPeople: number;
  /** people 数が前回比でこの比未満なら拒否 */
  minPeopleRatio: number;
  /** startTime 確定数が前回比でこの比未満なら拒否 */
  minConfirmedRatio: number;
  /** 期待する eventId */
  expectedEventId: number;
}

export const DEFAULT_QUALITY_OPTS: QualityOpts = {
  // 2026 の検証済みロスターは50名。取りこぼしを疑う水準として 45 を下限にする
  // （欠場による自然減はありうるが、10%超の減少は取得側の異常を先に疑う）。
  minPeople: 45,
  minPeopleRatio: 0.9,
  // startTime は開催前に 93 → 245 へ「増える」一方。減るのは異常。
  // ただし O-Ringen 側の再抽選で一時的に消える可能性は否定できないので 0.9 で緩めに取る。
  minConfirmedRatio: 0.9,
  expectedEventId: 25,
};

export type RejectReason =
  | "event_id_mismatch"
  | "too_few_people"
  | "people_regression"
  | "confirmed_starts_regression"
  | "stale_generated_at";

export interface QualityAssessment {
  ok: boolean;
  reason: RejectReason | null;
  detail: {
    prevPeople: number;
    nextPeople: number;
    prevConfirmed: number;
    nextConfirmed: number;
    prevGeneratedAt: string | null;
    nextGeneratedAt: string;
  };
}

/**
 * 新ペイロードを受け入れてよいか判定する。
 *
 * @param prev 既存データ。null = 初回（下限チェックのみ適用）
 */
export function assessQuality(
  prev: OringenData | null,
  next: OringenData,
  opts: QualityOpts = DEFAULT_QUALITY_OPTS,
): QualityAssessment {
  const nextPeople = next.people.length;
  const nextConfirmed = countConfirmedStarts(next.people);
  const prevPeople = prev?.people.length ?? 0;
  const prevConfirmed = prev ? countConfirmedStarts(prev.people) : 0;

  const detail = {
    prevPeople,
    nextPeople,
    prevConfirmed,
    nextConfirmed,
    prevGeneratedAt: prev?.generatedAt ?? null,
    nextGeneratedAt: next.generatedAt,
  };

  const reject = (reason: RejectReason): QualityAssessment => ({ ok: false, reason, detail });

  // 別大会のデータで上書きしない（eventId 取り違え・設定ミス）
  if (next.eventId !== opts.expectedEventId) return reject("event_id_mismatch");

  // 取得の部分失敗。初回でも適用する（壊れた初回で始めない）
  if (nextPeople < opts.minPeople) return reject("too_few_people");

  if (!prev) {
    // 既存なし＝初回。下限を満たしていれば書いてよい
    return { ok: true, reason: null, detail };
  }

  // 順序逆転（リトライ/並行実行）で新しいデータを古いもので潰さない。
  // 同時刻は許容する（再実行で同じ generatedAt になるケース）。
  if (Date.parse(next.generatedAt) < Date.parse(prev.generatedAt)) {
    return reject("stale_generated_at");
  }

  if (nextPeople < prevPeople * opts.minPeopleRatio) return reject("people_regression");
  if (nextConfirmed < prevConfirmed * opts.minConfirmedRatio) {
    return reject("confirmed_starts_regression");
  }

  return { ok: true, reason: null, detail };
}
