/**
 * スタートリスト行のクラブ員突合（配車割 Phase 4・純粋ロジック）。
 *
 * スタートリストは全クラス全員を含むため、まずクラブ員（joe_club_names）でフィルタし、
 * 残った行を既存メンバーと氏名突合する。突合方針は entry-detect.ts を踏襲:
 *   - 所属: splitAffiliations + normalizeClubName で分割・正規化 → クラブ集合と突合
 *           （matchAffiliation を再利用）。一致した行のみ結果に含める。
 *   - 氏名: normalizeNameKey で正規化し、athleteKey 索引（主）/ displayName 索引（フォールバック）
 *           と突合（exact）。フルネーム不一致時は、行・member 双方の「姓」（空白トークン境界の
 *           先頭トークン）が完全一致する member がちょうど 1 人なら surname、曖昧/不一致は none。
 *           prefix 一致は 1 文字姓（例「林」）が「林田…」へ誤マッチするため使わない（指摘 M1）。
 */

import { normalizeNameKey } from "@/lib/name-key";
import {
  normalizeClubNameSet,
  matchAffiliation,
  type ExistingMemberRef,
} from "@/lib/carpool/entry-detect";
import type { StartlistRow } from "@/lib/carpool/startlist/parse";

// 型を再エクスポートし、startlist 利用側が 1 箇所から import できるようにする。
export type { ExistingMemberRef };

/** スタートリスト 1 行のクラブ員突合結果。 */
export interface StartlistMatch {
  /** スタート時刻（`HH:MM`）。 */
  startTime: string;
  /** クラス名。 */
  className: string;
  /** 突合に用いた生氏名（StartlistRow.name）。 */
  rawName: string;
  /** 所属（生文字列）。 */
  affiliation: string;
  /** 一致した既存メンバー id。未一致なら null。 */
  memberId: string | null;
  /**
   * 突合確度。exact=フルネーム一致 / surname=姓の完全一致が一意（誤マッチの可能性があるため
   * 反映はユーザー確認＝override 必須） / none=不一致。
   */
  confidence: "exact" | "surname" | "none";
}

/**
 * 「姓 名」形式（空白を含む）の氏名から姓キー（先頭トークンの normalizeNameKey）を導出する。
 * 空白を含まない氏名（姓名連結・保存済み athleteKey 等）は姓境界が不明なため null を返し、
 * surname 突合に参加させない（指摘 M1: トークン境界の完全一致のみ）。
 */
function surnameKeyOf(raw: string): string | null {
  const tokens = (raw ?? "").trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return null;
  const key = normalizeNameKey(tokens[0]);
  return key || null;
}

/**
 * スタートリスト行をクラブ員でフィルタし、既存メンバーと氏名突合する純粋関数。
 *
 * @param rows         parseStartlistText の出力。
 * @param joeClubNames クラブの JOY 表記名リスト（生）。
 * @param members      既存 carpool_members（id + athleteKey [+ displayName]）。
 * @returns クラブ員行のみの突合結果（出現順）。joeClubNames が空なら空配列。
 */
export function matchStartlistRows(
  rows: StartlistRow[],
  joeClubNames: string[],
  members: ReadonlyArray<ExistingMemberRef>,
): StartlistMatch[] {
  const clubNameSet = normalizeClubNameSet(joeClubNames);
  if (clubNameSet.size === 0) return [];

  // exact 突合索引（entry-detect と同じ。athleteKey 優先・先勝ち）。
  const memberByAthleteKey = new Map<string, string>();
  const memberByNameKey = new Map<string, string>();

  // surname 索引: 姓キー → member id 集合。
  // 姓はトークン境界（空白）からのみ導出する（指摘 M1: prefix 一致は 1 文字姓の誤マッチを
  // 生むため廃止）。保存済み athleteKey は normalizeNameKey 済み（空白除去）のことが多く、
  // その場合は姓境界が取れないので索引に参加しない。displayName（「姓 名」表記）が主な供給源。
  const memberIdsBySurname = new Map<string, Set<string>>();

  const addSurname = (raw: string | null | undefined, id: string) => {
    if (!raw) return;
    const key = surnameKeyOf(raw);
    if (!key) return;
    const set = memberIdsBySurname.get(key) ?? new Set<string>();
    set.add(id);
    memberIdsBySurname.set(key, set);
  };

  for (const m of members) {
    if (m.athleteKey) {
      const ak = normalizeNameKey(m.athleteKey);
      if (ak && !memberByAthleteKey.has(ak)) memberByAthleteKey.set(ak, m.id);
      addSurname(m.athleteKey, m.id);
    }
    if (m.displayName) {
      const nk = normalizeNameKey(m.displayName);
      if (nk && !memberByNameKey.has(nk)) memberByNameKey.set(nk, m.id);
      addSurname(m.displayName, m.id);
    }
  }

  const results: StartlistMatch[] = [];
  for (const row of rows) {
    const matchedClubName = matchAffiliation(row.affiliation, clubNameSet);
    if (!matchedClubName) continue;

    const nameKey = normalizeNameKey(row.name);
    const exactId =
      memberByAthleteKey.get(nameKey) ?? memberByNameKey.get(nameKey) ?? null;

    if (exactId) {
      results.push({
        startTime: row.startTime,
        className: row.className,
        rawName: row.name,
        affiliation: row.affiliation,
        memberId: exactId,
        confidence: "exact",
      });
      continue;
    }

    // surname フォールバック（exact が取れなかった行のみ）。
    // 行側も「姓 名」形式（2 トークン以上）のときだけ姓を導出し、姓キーの完全一致で突合する。
    // 一致する member がちょうど 1 人なら surname、0 または複数（同姓で曖昧）なら none。
    const rowSurnameKey = surnameKeyOf(row.name);
    const candidateIds =
      (rowSurnameKey ? memberIdsBySurname.get(rowSurnameKey) : undefined) ??
      new Set<string>();
    if (candidateIds.size === 1) {
      const [only] = candidateIds;
      results.push({
        startTime: row.startTime,
        className: row.className,
        rawName: row.name,
        affiliation: row.affiliation,
        memberId: only,
        confidence: "surname",
      });
      continue;
    }

    results.push({
      startTime: row.startTime,
      className: row.className,
      rawName: row.name,
      affiliation: row.affiliation,
      memberId: null,
      confidence: "none",
    });
  }

  return results;
}
