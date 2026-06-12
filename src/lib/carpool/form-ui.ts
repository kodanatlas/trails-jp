/**
 * 参加フォーム UI の純粋ロジック（R3/R4/R6）。
 *
 * - R4: UI ロール「同乗者（乗る車が決まっている）」は DB を変えず
 *       role='rider' + fixed_driver_member_id で表現する。その双方向マッピング。
 * - R3: 時刻入力の 15 分刻み step（既存の 15 分外の値を壊さない）。
 * - R6: 配車計画プレースホルダの表示判定とサマリ。
 */

/** API のロール（DB CHECK と一致）。 */
export type ApiRole = "driver" | "rider" | "self" | "absent";

/** UI のロール。passenger は UI 専用（API では rider + fixedDriver）。 */
export type FormRole = "driver" | "passenger" | "rider" | "self" | "absent";

/** UI ロール → API ロール。passenger は rider に畳む。 */
export function toApiRole(formRole: FormRole): ApiRole {
  return formRole === "passenger" ? "rider" : formRole;
}

/**
 * 既存 participation → UI ロール。
 * - rider は fixedDriverMemberId の有無で 同乗者 / 同乗希望 に分かれる。
 * - undecided（回答待ち）は回答を促す既定値（車ありなら運転手、なければ同乗希望）に倒す。
 */
export function participationToFormRole(
  role: ApiRole | "undecided",
  fixedDriverMemberId: string | null,
  memberHasCar: boolean,
): FormRole {
  if (role === "undecided") return memberHasCar ? "driver" : "rider";
  if (role === "rider") return fixedDriverMemberId ? "passenger" : "rider";
  return role;
}

/**
 * R3: `<input type="time">` の step（秒）。
 * 値が空・不正・15 分グリッド上なら 900（15分刻み）、グリッド外の既存値（自動設定の
 * 分単位値など）は 60 に落として stepMismatch でフォーム送信が壊れないようにする。
 */
export function quarterHourStep(value: string): number {
  if (!value) return 900;
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!m) return 900;
  return Number(m[2]) % 15 === 0 ? 900 : 60;
}

/** R6: 配車計画プレースホルダ用サマリ。 */
export interface PlanReadiness {
  /** 確定参加（driver + rider + self。absent / undecided は除く）。 */
  participantCount: number;
  /** 運転手の台数。 */
  driverCount: number;
  /** 運転手 1+ かつ 同乗（rider: 同乗者・同乗希望とも）1+ で配車計画が意味を持つ。 */
  ready: boolean;
}

export function summarizeForPlan(
  participations: ReadonlyArray<{ role: string }>,
): PlanReadiness {
  let drivers = 0;
  let riders = 0;
  let selfs = 0;
  for (const p of participations) {
    if (p.role === "driver") drivers++;
    else if (p.role === "rider") riders++;
    else if (p.role === "self") selfs++;
  }
  return {
    participantCount: drivers + riders + selfs,
    driverCount: drivers,
    ready: drivers >= 1 && riders >= 1,
  };
}
