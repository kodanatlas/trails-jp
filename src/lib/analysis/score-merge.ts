/** 同一ランキングファイル内に同名が複数現れる氏名（＝未検出の同姓同名の疑い）を返す */
export function findDuplicateNames(
  entries: readonly { athlete_name: string }[],
): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const entry of entries) {
    const normalizedName = entry.athlete_name.replace(/\s+/g, "");
    if (seen.has(normalizedName)) {
      duplicates.add(normalizedName);
    } else {
      seen.add(normalizedName);
    }
  }

  return duplicates;
}

/** 既存スコアのマージキー。未検出の同姓同名だけは所属を含めて衝突を避ける。 */
export function makeScoreMergeKey(
  entry: { athlete_name: string; club: string },
  duplicateNames: ReadonlySet<string>,
): string {
  const normalizedName = entry.athlete_name.replace(/\s+/g, "");
  const isDuplicate = [...duplicateNames].some(
    (name) => name.replace(/\s+/g, "") === normalizedName,
  );
  if (isDuplicate) {
    return `${normalizedName} ${entry.club}`;
  }
  return normalizedName;
}
