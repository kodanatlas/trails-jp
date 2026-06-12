/**
 * オンボーディング（クラブ作成→作成者の member 化）の純粋ロジック（ウォークスルー M1）。
 *
 * クラブ作成フォームの「あなたの名前」から、作成者自身を member 化する
 * `POST /clubs/[slug]/members` の body を組み立てる。athleteKey は意図的に含めない
 * （members POST がサーバ側で normalizeNameKey(displayName) を自動付与する・指摘1実装）。
 */

/** 作成者 member 化リクエストの body（members POST の最小形）。 */
export interface CreatorMemberBody {
  /** 操作者名 = 作成者本人の名前（自己登録なので displayName と同値）。 */
  actorName: string;
  /** 表示名 = 作成者本人の名前。 */
  displayName: string;
}

/**
 * クラブ作成フォームの actorName 入力 → member 作成 body。
 * 空白のみ・空文字なら null（member 化をスキップする判断は呼び出し側）。
 */
export function buildCreatorMemberBody(actorName: string): CreatorMemberBody | null {
  const name = (actorName ?? "").trim();
  if (!name) return null;
  return { actorName: name, displayName: name };
}
