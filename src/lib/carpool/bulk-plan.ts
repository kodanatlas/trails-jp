/**
 * 検出パネルからの一括参加登録（bulk）の純粋計画ロジック。
 *
 * route ハンドラ（DB I/O 付き）が「既に参加行がある member は role を上書きしない」方針を
 * 守れるよう、insert すべき行と skip する行を純粋関数で切り分ける。DB 依存はここに入れない。
 *
 * 設計（C-4 安全側）: 既存参加行がある member は role を変えない（skip）。新規 member や
 * まだ参加していない既存 member だけ role='undecided' で insert する。
 */

/** bulk 入力の1行を route 層で「memberId に解決済み」にした形。 */
export interface ResolvedBulkEntry {
  /** 既存 or 新規作成済みの member id。 */
  memberId: string;
  /** 表示用クラス（検出由来・任意）。 */
  className: string | null;
}

export interface BulkPlan<T extends ResolvedBulkEntry> {
  /** 参加行を新規 insert する対象（既存参加行が無い member）。 */
  toInsert: T[];
  /** 既に参加行があるため insert をスキップする対象。 */
  skipped: T[];
}

/**
 * 純粋ロジック: 解決済みエントリー群を、既存参加 member 集合をもとに insert/skip に振り分ける。
 *
 * - 同一 memberId が入力に複数あった場合は先勝ちで 1 件に正規化する
 *   （同一バッチ内の重複キー insert で Postgres がエラーになるのを防ぐ）。
 * - existingMemberIds に含まれる memberId は skip（role を上書きしない）。
 *
 * @param entries          memberId に解決済みのエントリー
 * @param existingMemberIds 当該イベントで既に参加行を持つ member id 集合
 */
export function planBulkParticipations<T extends ResolvedBulkEntry>(
  entries: ReadonlyArray<T>,
  existingMemberIds: ReadonlySet<string>,
): BulkPlan<T> {
  const seen = new Set<string>();
  const toInsert: T[] = [];
  const skipped: T[] = [];

  for (const e of entries) {
    // バッチ内重複は先勝ちで 1 件化。
    if (seen.has(e.memberId)) continue;
    seen.add(e.memberId);

    if (existingMemberIds.has(e.memberId)) {
      skipped.push(e);
    } else {
      toInsert.push(e);
    }
  }

  return { toInsert, skipped };
}
