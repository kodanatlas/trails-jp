/**
 * 「あなたはどれ？」カード（Phase 5.5 blocker）の純粋ロジック。
 *
 * 調整さんモデル: 端末に選択を保存しない（毎回選ぶ）ため、
 * 「自分の行が探さなくても見つかる」ことをソートと検索で担保する。
 *   - 統合: 検出（JOY エントリー）+ 登録済み participation + active メンバーを 1 リストに重複なく束ねる
 *   - ソート: クラブ一致（検出由来）→ 氏名順（ja ロケール）
 *   - 検索: 入力即絞込（空白無視・ASCII は大文字小文字無視）。バジェット外の任意操作。
 */

/** 検出行のうちカードに必要な最小情報（DetectedEntry のサブセット）。 */
export interface SelfPickDetectedInput {
  nameKey: string;
  memberId: string | null;
  rawName?: string | null;
  className?: string | null;
}

/** メンバーのうちカードに必要な最小情報（MemberDTO のサブセット）。 */
export interface SelfPickMemberInput {
  id: string;
  displayName: string;
  active: boolean;
}

/** participation のうちカードに必要な最小情報。 */
export interface SelfPickParticipationInput {
  memberId: string;
  role: string;
}

/** カードの1チップ。 */
export interface SelfPickChoice {
  /** 行キー（member 確定済みは member id、未登録検出は "det:"+nameKey）。 */
  key: string;
  /** 既存 member id（未登録検出は null）。 */
  memberId: string | null;
  /** 表示名。 */
  displayName: string;
  /** クラブ一致の検出（JOY エントリー）由来か。ソート第一キー。 */
  clubMatched: boolean;
  /** この大会の既存 participation の role（未登録なら null）。バッジ・役割変更の初期値用。 */
  role: string | null;
  /** 検出由来情報（未登録検出のクイック登録に必要。検出由来でなければ null）。 */
  detected: {
    nameKey: string;
    className: string | null;
    rawName: string | null;
  } | null;
}

/**
 * 検出 + 登録済み + active メンバーを統合し、クラブ一致→氏名順でソートしたチップ列を返す。
 *
 * 統合規則（重複なし）:
 *   1. 検出行（memberId 突合済みは member 表示名を優先、未登録は rawName > nameKey）→ clubMatched=true
 *   2. 検出に居ない participation 保持者（手動登録など）→ clubMatched=false
 *   3. 検出にも participation にも居ない active メンバー → clubMatched=false
 *      （JOY 連携なし大会や直前参加でも自分が見つかるようにするための包含。
 *        ここに居ない人だけが「行を追加」へフォールバックする）
 */
export function buildSelfPickChoices(
  detected: ReadonlyArray<SelfPickDetectedInput>,
  members: ReadonlyArray<SelfPickMemberInput>,
  participations: ReadonlyArray<SelfPickParticipationInput>,
): SelfPickChoice[] {
  const memberById = new Map(members.map((m) => [m.id, m]));
  const roleByMemberId = new Map(participations.map((p) => [p.memberId, p.role]));
  const out = new Map<string, SelfPickChoice>();

  // 1) 検出行（クラブ一致）。
  for (const d of detected) {
    const key = d.memberId ?? `det:${d.nameKey}`;
    if (out.has(key)) continue;
    const member = d.memberId ? memberById.get(d.memberId) : undefined;
    const displayName =
      member?.displayName ||
      (d.rawName ?? "").trim() ||
      d.nameKey;
    out.set(key, {
      key,
      memberId: d.memberId,
      displayName,
      clubMatched: true,
      role: d.memberId ? roleByMemberId.get(d.memberId) ?? null : null,
      detected: {
        nameKey: d.nameKey,
        className: d.className || null,
        rawName: (d.rawName ?? "").trim() || null,
      },
    });
  }

  // 2) 検出に居ない participation 保持者。
  for (const p of participations) {
    if (out.has(p.memberId)) continue;
    const member = memberById.get(p.memberId);
    if (!member) continue; // member 不明の participation はカードに出せない（プラン側の整合チェックに委ねる）
    out.set(p.memberId, {
      key: p.memberId,
      memberId: p.memberId,
      displayName: member.displayName,
      clubMatched: false,
      role: p.role,
      detected: null,
    });
  }

  // 3) 残りの active メンバー。
  for (const m of members) {
    if (!m.active || out.has(m.id)) continue;
    out.set(m.id, {
      key: m.id,
      memberId: m.id,
      displayName: m.displayName,
      clubMatched: false,
      role: null,
      detected: null,
    });
  }

  return [...out.values()].sort(compareSelfPickChoices);
}

/** ソート: クラブ一致（検出由来）が先 → 氏名順（ja ロケール）。 */
export function compareSelfPickChoices(a: SelfPickChoice, b: SelfPickChoice): number {
  if (a.clubMatched !== b.clubMatched) return a.clubMatched ? -1 : 1;
  return a.displayName.localeCompare(b.displayName, "ja");
}

/** 検索用正規化: 全空白（全角含む）除去 + ASCII 小文字化。 */
export function normalizeSelfPickQuery(raw: string): string {
  return (raw ?? "").replace(/[\s　]+/g, "").toLowerCase();
}

/**
 * 名前検索の絞込（入力即時・部分一致）。空クエリは全件をそのまま返す。
 * 「山田 太郎」「山田太郎」どちらの表記でも当たるよう、両辺とも空白を無視して比較する。
 */
export function filterSelfPickChoices(
  choices: ReadonlyArray<SelfPickChoice>,
  query: string,
): SelfPickChoice[] {
  const q = normalizeSelfPickQuery(query);
  if (!q) return [...choices];
  return choices.filter((c) =>
    normalizeSelfPickQuery(c.displayName).includes(q),
  );
}
