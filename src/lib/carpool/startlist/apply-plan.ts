/**
 * スタートリスト反映対象の決定（配車割 Phase 4・純粋ロジック）。
 *
 * import-startlist ルートの apply=true 時に「どの member のどの列をどの値で更新するか」を
 * 決める。route ハンドラから切り出してテスト対象にする（ウォークスルー指摘 B1 / M1）。
 *
 *   - B1: 列ごとの部分更新。startTime / className が undefined の列は UPDATE しない。
 *         match 値が空文字（PDF/貼付に時刻・クラスが無かった）の列は「情報なし」であり、
 *         手入力済みの participation 値を null で潰さない。明示クリアは override の null のみ。
 *   - M1: confidence === "surname"（姓のみ一致）の行は誤マッチの可能性があるため、
 *         override（ユーザーがプレビューで行を確認・編集した印）がある場合のみ反映する。
 */

import type { StartlistMatch } from "@/lib/carpool/startlist/match";

/** apply=true 時のユーザー編集値（API body の overrides 要素と同形）。 */
export interface ImportOverride {
  memberId: string;
  /** undefined = 未編集（match 値にフォールバック）。null = 明示クリア。 */
  startTime?: string | null;
  className?: string | null;
}

/** 反映 1 件。startTime / className の undefined は「当該列を UPDATE しない」。 */
export interface ApplyTarget {
  memberId: string;
  rawName: string;
  startTime?: string | null;
  className?: string | null;
}

/** 反映対象外の 1 行（理由つき・日本語）。 */
export interface ApplySkipped {
  rawName: string;
  className: string;
  reason: string;
}

/**
 * 突合結果と override から反映対象を決定する純粋関数。
 *
 * @param matches                matchStartlistRows の出力（プレビューと同じもの）。
 * @param overrides              UI で編集/確認された行（memberId 単位）。
 * @param participatingMemberIds この event に participation がある member id 集合。
 * @returns targets（更新対象。列は undefined=不変）と skipped（理由つき）。
 */
export function buildApplyTargets(
  matches: ReadonlyArray<StartlistMatch>,
  overrides: ReadonlyArray<ImportOverride>,
  participatingMemberIds: ReadonlySet<string>,
): { targets: ApplyTarget[]; skipped: ApplySkipped[] } {
  const overrideByMember = new Map(overrides.map((o) => [o.memberId, o]));

  const targets: ApplyTarget[] = [];
  const skipped: ApplySkipped[] = [];
  const seen = new Set<string>();

  for (const m of matches) {
    if (m.memberId === null || m.confidence === "none") {
      skipped.push({ rawName: m.rawName, className: m.className, reason: "メンバー未特定" });
      continue;
    }
    if (!participatingMemberIds.has(m.memberId)) {
      skipped.push({ rawName: m.rawName, className: m.className, reason: "未参加登録" });
      continue;
    }

    const ov = overrideByMember.get(m.memberId);

    // M1: 姓のみ一致は override（ユーザー確認）がある場合のみ反映する。
    if (m.confidence === "surname" && !ov) {
      skipped.push({
        rawName: m.rawName,
        className: m.className,
        reason: "姓のみ一致（未確認のため反映されません）",
      });
      continue;
    }

    // 同一 member が複数行に出た場合は先勝ちで 1 件化（スタートリストの重複行対策）。
    if (seen.has(m.memberId)) continue;
    seen.add(m.memberId);

    // B1: 列ごとに独立して決定する。
    //   1) override にキーがある（!== undefined）→ その値（null = 明示クリア）。
    //   2) キーが無く match の値が非空 → match 値。
    //   3) どちらも無い → undefined（列を触らない = 既存の手入力値を保持）。
    const startTime =
      ov && ov.startTime !== undefined ? ov.startTime : m.startTime || undefined;
    const className =
      ov && ov.className !== undefined ? ov.className : m.className || undefined;

    if (startTime === undefined && className === undefined) {
      skipped.push({
        rawName: m.rawName,
        className: m.className,
        reason: "反映する値がありません",
      });
      continue;
    }

    const target: ApplyTarget = { memberId: m.memberId, rawName: m.rawName };
    if (startTime !== undefined) target.startTime = startTime;
    if (className !== undefined) target.className = className;
    targets.push(target);
  }

  return { targets, skipped };
}
