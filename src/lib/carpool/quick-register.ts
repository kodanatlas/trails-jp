/**
 * 検出行からの単独クイック登録（M4: 代理操作）の純粋計画ロジック。
 *
 * 性善説運用: 配車係や気の利くメンバーが本人に代わって役割を設定できる。
 * 検出パネルの1行から「運転手として登録」「同乗希望として登録」を選んだとき、
 *   - 既存 member（突合済み）→ participation upsert のみ
 *   - 未登録 → member 作成（athleteKey=検出 nameKey）+ participation upsert
 * の計画を組み立てる。I/O は持たない（route 呼び出しはクライアント側）。
 *
 * actor_name は操作者のまま change_log に残る（既存設計どおり・ここでは扱わない）。
 */

/** クイック登録で選べるロール（undecided は一括登録専用なので含めない）。 */
export type QuickRole = "driver" | "rider";

/** 検出行のうち計画に必要な最小情報。 */
export interface QuickRegisterInput {
  /** 突合済み member id。未登録なら null。 */
  memberId: string | null;
  /** 検出キー（未登録時の athleteKey に使う・不変）。 */
  nameKey: string;
  /** 表示用生氏名（あれば）。 */
  rawName?: string | null;
  /** 検出クラス（あれば）。 */
  className: string | null;
  /** 未登録行の名前確認入力（ユーザーが整形した「姓 名」など・あれば最優先）。 */
  displayNameInput?: string | null;
  /**
   * R5: 運転手クイック登録時の同乗可能人数入力（未登録メンバーの最小ステップ）。
   * 数値として有効（0〜20）なら member 作成 body の seatsAvailable に入れる。
   */
  seatsInput?: string | null;
}

/** member 作成が必要な場合の body 断片（actorName はクライアントが付与）。 */
export interface QuickMemberBody {
  displayName: string;
  athleteKey: string;
  /** 運転手として登録するなら車ありで作る（プロフィール既定の妥当化）。 */
  hasCar: boolean;
  /** R5: 運転手登録時のみ・有効入力時のみ付与（プロフィール既定の同乗可能人数）。 */
  seatsAvailable?: number;
}

/** 同乗可能人数入力のパース（0〜20 の整数のみ有効、それ以外は undefined）。 */
function parseSeats(input: string | null | undefined): number | undefined {
  const t = (input ?? "").trim();
  if (!/^\d{1,2}$/.test(t)) return undefined;
  const n = Number(t);
  return n >= 0 && n <= 20 ? n : undefined;
}

export interface QuickRegisterPlan {
  /** null = member 作成不要（既存 member）。 */
  memberBody: QuickMemberBody | null;
  role: QuickRole;
  /** participation に保存するクラス（空文字は null に正規化）。 */
  className: string | null;
}

/**
 * 検出行 + 選択ロール → クイック登録計画。
 *
 * 未登録行の表示名は 名前確認入力 > rawName > nameKey の順で採用（trim 後に空なら次へ）。
 * athleteKey は常に検出 nameKey をそのまま使う（表示名を整形しても突合キーは不変）。
 */
export function planQuickRegister(
  input: QuickRegisterInput,
  role: QuickRole,
): QuickRegisterPlan {
  const className = input.className || null;

  if (input.memberId) {
    return { memberBody: null, role, className };
  }

  const displayName =
    (input.displayNameInput ?? "").trim() ||
    (input.rawName ?? "").trim() ||
    input.nameKey;

  const seats = role === "driver" ? parseSeats(input.seatsInput) : undefined;

  return {
    memberBody: {
      displayName,
      athleteKey: input.nameKey,
      hasCar: role === "driver",
      ...(seats !== undefined ? { seatsAvailable: seats } : {}),
    },
    role,
    className,
  };
}
