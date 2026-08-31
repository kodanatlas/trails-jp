/** 同一ランキングファイル内に同名が複数現れる氏名（＝未検出の同姓同名の疑い）を返す */
export function findDuplicateNames(
  entries: readonly { athlete_name: string }[],
): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const entry of entries) {
    if (seen.has(entry.athlete_name)) {
      duplicates.add(entry.athlete_name);
    } else {
      seen.add(entry.athlete_name);
    }
  }

  return duplicates;
}

/** 既存スコアのマージキー。未検出の同姓同名だけは所属を含めて衝突を避ける。 */
export function makeScoreMergeKey(
  entry: { athlete_name: string; club: string },
  duplicateNames: ReadonlySet<string>,
): string {
  if (duplicateNames.has(entry.athlete_name)) {
    return `${entry.athlete_name} ${entry.club}`;
  }
  return entry.athlete_name;
}
