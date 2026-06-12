"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { actorStorageKey, actorMemberStorageKey } from "./storageKeys";
import type { MemberDTO } from "@/lib/carpool/api/mappers";

/** クライアントでのみ localStorage の member_id（新キー）を読む（SSR では null）。 */
function readActorMemberId(slug: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(actorMemberStorageKey(slug));
    return stored && stored.length > 0 ? stored : null;
  } catch {
    return null;
  }
}

/** クライアントでのみ旧キー（名前文字列）を読む（移行用）。 */
function readLegacyActorName(slug: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(actorStorageKey(slug));
    return stored && stored.length > 0 ? stored : null;
  } catch {
    return null;
  }
}

export interface UseActorResult {
  /** localStorage の member_id（解決前でも読める）。未設定は null。 */
  actorMemberId: string | null;
  /** 解決後の display_name（API の actorName に渡す）。未解決は null。 */
  actorName: string | null;
  /** 解決した member（未解決は null）。 */
  member: MemberDTO | null;
  /** クライアントで初期化済みか（SSR/CSR 不一致回避用）。 */
  ready: boolean;
  /** member 選択/作成時に呼ぶ。member_id と name を保存。 */
  setActorMember: (member: MemberDTO) => void;
  clearActor: () => void;
}

/**
 * クラブ slug ごとの操作者を **member 単位**で localStorage に永続化するフック。
 * 全 write リクエストの actorName には解決後の display_name を渡す。
 *
 * 旧仕様（名前文字列キー `carpool.actor.<slug>`）からの移行を内包する:
 *   - 新キー（member_id）があればそれで解決。
 *   - 無く旧キー（名前）があれば、members から display_name 一致の active member を探し、
 *     見つかれば新キーに member_id を保存して移行する。見つからなければ未設定扱い。
 *
 * members はロード前は空配列で渡ってくるため、member 解決は members 到着後に行う
 * （effect 内で再解決。解決結果が同じなら setState しないループ防止）。
 */
export function useActor(slug: string, members: MemberDTO[]): UseActorResult {
  const [actorMemberId, setActorMemberId] = useState<string | null>(() =>
    readActorMemberId(slug),
  );
  const [ready] = useState<boolean>(() => typeof window !== "undefined");

  // members 到着後に旧キー（名前）→ member_id 移行を試みる。
  useEffect(() => {
    if (!ready || actorMemberId !== null || members.length === 0) return;
    const legacyName = readLegacyActorName(slug);
    if (!legacyName) return;
    const matched = members.find((m) => m.active && m.displayName === legacyName);
    if (!matched) return;
    try {
      window.localStorage.setItem(actorMemberStorageKey(slug), matched.id);
    } catch {
      /* localStorage 不可環境では state のみ更新 */
    }
    setActorMemberId(matched.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, slug, members]);

  // member_id から member / actorName を解決（members 変化に追従）。
  const member = useMemo<MemberDTO | null>(() => {
    if (!actorMemberId) return null;
    return members.find((m) => m.id === actorMemberId) ?? null;
  }, [actorMemberId, members]);

  const actorName = member?.displayName ?? null;

  const setActorMember = useCallback(
    (m: MemberDTO) => {
      try {
        window.localStorage.setItem(actorMemberStorageKey(slug), m.id);
        // 互換: 旧キーにも名前を残しておく（他タブ・旧コードとの併存安全）。
        window.localStorage.setItem(actorStorageKey(slug), m.displayName);
      } catch {
        /* localStorage 不可環境では state のみ更新 */
      }
      setActorMemberId(m.id);
    },
    [slug],
  );

  const clearActor = useCallback(() => {
    try {
      window.localStorage.removeItem(actorMemberStorageKey(slug));
      window.localStorage.removeItem(actorStorageKey(slug));
    } catch {
      /* noop */
    }
    setActorMemberId(null);
  }, [slug]);

  return { actorMemberId, actorName, member, ready, setActorMember, clearActor };
}
