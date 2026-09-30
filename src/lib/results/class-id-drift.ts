/**
 * mulka2 のクラスID は、主催者が結果を再掲載すると振り直されることがある
 * （2026-09-30 実測: 中高選手権 個人 ev=9974 の AL1 が取込時の class 12 → class 6。class 12 は別クラスに）。
 * DB に保存した ID でリンクすると別クラスを開くため、リンクに添えたクラス名（cn）で現在の ID を引き直す。
 */

export interface ClassRef {
  classId: number;
  className: string;
}

/**
 * 開こうとした classId のクラス名が cn と違い、cn の名前のクラスがちょうど 1 つあれば、その classId を返す。
 * 一致している・cn のクラスが無い／複数ある（決められない）ときは null＝そのまま開く。
 */
export function resolveDriftedClassId(
  classes: readonly ClassRef[],
  classId: number,
  cn: string | null
): number | null {
  if (!cn) return null;
  if (classes.find((c) => c.classId === classId)?.className === cn) return null;
  const named = classes.filter((c) => c.className === cn);
  return named.length === 1 && named[0].classId !== classId ? named[0].classId : null;
}
