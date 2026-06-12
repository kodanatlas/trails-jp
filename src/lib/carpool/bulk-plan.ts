/**
 * 検出パネルからの一括参加登録（bulk）の純粋計画ロジック。
 *
 * route ハンドラ（DB I/O 付き）が「既に参加行がある member は role を上書きしない」方針を
 * 守れるよう、insert すべき行と skip する行を純粋関数で切り分ける。DB 依存はここに入れない。
 *
 * 設計（C-4 安全側）: 既存参加行がある member は role を変えない（skip）。新規 member や
 * まだ参加していない既存 member だけ role='undecided' で insert する。
 */

import { normalizeNameKey } from "@/lib/name-key";
import { PARTICIPATION_BULK_LIMIT } from "./api/constants";

/** 重複作成防止用の最小メンバー情報（indexMembersByKey の入力）。 */
export interface MemberKeyRef {
  id: string;
  athleteKey: string | null | undefined;
  displayName: string | null | undefined;
}

/**
 * 同 club の member 群を「正準キー → member id」の索引にする（指摘1: 重複作成防止の最後の砦）。
 *
 * - athlete_key を先に索引し、その後 display_name を索引する（同キー衝突時は **athlete_key 優先**）。
 * - キーは normalizeNameKey で正準化（NFKC + 空白除去）。同一キーは先勝ち（決定性のため）。
 *
 * route 側は newMember 作成前にこの索引を引き、既存 active member が居れば再利用する。
 */
export function indexMembersByKey(
  members: ReadonlyArray<MemberKeyRef>,
): Map<string, string> {
  const map = new Map<string, string>();
  const put = (rawKey: string | null | undefined, id: string) => {
    if (!rawKey) return;
    const k = normalizeNameKey(rawKey);
    if (k && !map.has(k)) map.set(k, id);
  };
  for (const m of members) put(m.athleteKey, m.id);
  for (const m of members) put(m.displayName, m.id);
  return map;
}

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

/**
 * m2: bulk API の上限（PARTICIPATION_BULK_LIMIT=30）を超える選択を無言で切り捨てず、
 * クライアント側で 30 件ずつのチャンクに分割して順次送信するための純粋関数。
 *
 * - 入力順を保ったまま size 件ごとに分割（最後のチャンクは端数）。
 * - 空入力は []。size が不正（<=0）でも全件 1 チャンクに収めて何も失わない（安全側）。
 */
export function chunkBulkEntries<T>(
  entries: ReadonlyArray<T>,
  size: number = PARTICIPATION_BULK_LIMIT,
): T[][] {
  if (entries.length === 0) return [];
  if (size <= 0) return [[...entries]];
  const chunks: T[][] = [];
  for (let i = 0; i < entries.length; i += size) {
    chunks.push(entries.slice(i, i + size));
  }
  return chunks;
}
