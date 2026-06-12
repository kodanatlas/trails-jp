/**
 * エントリー自動検出（FR-3）。
 *
 * trails.jp の entry-index.json から、ある大会（joe_event_id）に出ているエントリーのうち
 * 当該クラブ所属（表記ゆれ・複数所属対応）の者を抽出し、既存メンバーと突合する。
 *
 * 純粋ロジック（detectClubEntries）と Storage 読込（detectEntriesForEvent）を分離し、
 * 純粋部分を vitest でテストする。
 *
 * 突合方針:
 *   - 所属: splitAffiliations + normalizeClubName で分割・正規化 → クラブの joe_club_names
 *           （同じく正規化）と集合突合。1つでも一致すればクラブ員。
 *   - 氏名: normalizeNameKey で正規化したキーで既存 carpool_members.athlete_key と突合。
 */

import { splitAffiliations, normalizeClubName } from "@/lib/club-normalize";
import { normalizeNameKey } from "@/lib/name-key";
import type { AthleteEntryRef, EntryIndex } from "@/lib/entries/index-types";

/** 既存メンバー（突合に必要な最小情報）。athlete_key は null の場合あり。 */
export interface ExistingMemberRef {
  id: string;
  athleteKey: string | null;
  /**
   * 表示名（突合フォールバック用・任意）。athleteKey が無い／一致しないときに
   * normalizeNameKey(displayName) で再突合するために使う（指摘1: 名前の重複防止）。
   */
  displayName?: string | null;
}

/** 検出された1エントリーの結果行。 */
export interface DetectedEntry {
  /** エントリー氏名（entry-index のキー = normalizeNameKey 済み）。 */
  nameKey: string;
  /** 表示用クラス（M21A 等）。 */
  className: string;
  /** エントリー時の所属（生文字列・表示用）。 */
  affiliation: string;
  /** 突合に成功したクラブ正規化名（joe_club_names 側の値）。 */
  matchedClubName: string;
  /** 既存メンバーに一致した場合の member id。未登録なら null。 */
  memberId: string | null;
  /** 既存メンバーとして登録済みか。 */
  alreadyRegistered: boolean;
}

/**
 * クラブの joe_club_names を正規化した集合に変換する。
 * 表記ゆれ（「入間市olc」等）は normalizeClubName の olc→OLC ルールで吸収される。
 */
export function normalizeClubNameSet(joeClubNames: string[]): Set<string> {
  const set = new Set<string>();
  for (const raw of joeClubNames) {
    const norm = normalizeClubName(raw);
    if (norm) set.add(norm);
  }
  return set;
}

/**
 * ある所属文字列がクラブ集合に属するか判定し、一致したクラブ正規化名を返す。
 * 複数所属（"A/B"）は splitAffiliations で分割し、最初に一致したものを返す。
 */
export function matchAffiliation(
  affiliation: string,
  clubNameSet: Set<string>,
): string | null {
  const parts = splitAffiliations(affiliation);
  for (const part of parts) {
    if (clubNameSet.has(part)) return part;
  }
  return null;
}

/**
 * 純粋ロジック: あるイベントのエントリー配列から、クラブ員エントリーを抽出して
 * 既存メンバーと突合する。
 *
 * @param entries          当該大会の全エントリー（氏名キー付き）
 * @param joeClubNames     クラブの JOY 表記名リスト（生）
 * @param existingMembers  既存 carpool_members（id + athlete_key）
 */
export function detectClubEntries(
  entries: ReadonlyArray<EntryWithNameKey>,
  joeClubNames: string[],
  existingMembers: ReadonlyArray<ExistingMemberRef>,
): DetectedEntry[] {
  const clubNameSet = normalizeClubNameSet(joeClubNames);
  if (clubNameSet.size === 0) return [];

  // 既存メンバーの突合索引（normalizeNameKey 済み前提だが念のため再正規化）。
  //   1) athlete_key 索引（主）。
  //   2) normalizeNameKey(display_name) 索引（フォールバック・指摘1）。
  // athlete_key が無い／一致しない member でも、自己登録時の表示名から導いた正準キーで
  // 同一人物を拾えるようにする。athlete_key の一致を優先する（先に引く）。
  const memberByAthleteKey = new Map<string, string>();
  const memberByNameKey = new Map<string, string>();
  for (const m of existingMembers) {
    if (m.athleteKey) {
      const ak = normalizeNameKey(m.athleteKey);
      // 同一キーは先勝ち（重複データ時の決定性を保つ）。
      if (ak && !memberByAthleteKey.has(ak)) memberByAthleteKey.set(ak, m.id);
    }
    if (m.displayName) {
      const nk = normalizeNameKey(m.displayName);
      if (nk && !memberByNameKey.has(nk)) memberByNameKey.set(nk, m.id);
    }
  }

  const results: DetectedEntry[] = [];
  for (const e of entries) {
    const matchedClubName = matchAffiliation(e.affiliation, clubNameSet);
    if (!matchedClubName) continue;

    const nameKey = e.nameKey;
    const memberId =
      memberByAthleteKey.get(nameKey) ?? memberByNameKey.get(nameKey) ?? null;
    results.push({
      nameKey,
      className: e.className,
      affiliation: e.affiliation,
      matchedClubName,
      memberId,
      alreadyRegistered: memberId !== null,
    });
  }
  return results;
}

/** 純粋ロジック入力: エントリー + 氏名キー。 */
export interface EntryWithNameKey {
  nameKey: string;
  className: string;
  affiliation: string;
}

/**
 * entry-index（氏名キー → エントリー配列）から、特定大会のエントリーを
 * EntryWithNameKey[] に変換する。氏名キーは index のキーそのもの。
 */
export function collectEntriesForEvent(
  index: EntryIndex,
  joeEventId: number,
): EntryWithNameKey[] {
  const out: EntryWithNameKey[] = [];
  for (const [nameKey, refs] of Object.entries(index.athletes)) {
    for (const ref of refs as AthleteEntryRef[]) {
      if (ref.joe_event_id === joeEventId) {
        out.push({
          nameKey,
          className: ref.className,
          affiliation: ref.affiliation,
        });
      }
    }
  }
  return out;
}

/**
 * I/O 付きエントリポイント: Storage の entry-index を読み、検出結果を返す。
 * Storage 読込は呼び出し側から注入可能（テスト・将来差し替え用）。
 *
 * @returns 検出結果（index 未生成時は空配列）。
 */
export async function detectEntriesForEvent(
  joeEventId: number,
  joeClubNames: string[],
  existingMembers: ReadonlyArray<ExistingMemberRef>,
  readIndex: () => Promise<EntryIndex | null>,
): Promise<{ generatedAt: string | null; detected: DetectedEntry[] }> {
  const index = await readIndex();
  if (!index) return { generatedAt: null, detected: [] };
  const entries = collectEntriesForEvent(index, joeEventId);
  const detected = detectClubEntries(entries, joeClubNames, existingMembers);
  return { generatedAt: index.generatedAt, detected };
}
