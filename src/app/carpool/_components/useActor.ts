"use client";

import { useCallback, useState } from "react";
import { actorStorageKey } from "./storageKeys";

/** クライアントでのみ localStorage から操作者名を読む（SSR では null）。 */
function readActor(slug: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(actorStorageKey(slug));
    return stored && stored.length > 0 ? stored : null;
  } catch {
    return null;
  }
}

export interface UseActorResult {
  actorName: string | null;
  /** クライアントで初期化済みか（SSR/CSR 不一致回避用）。 */
  ready: boolean;
  setActor: (name: string) => void;
  clearActor: () => void;
}

/**
 * クラブ slug ごとの操作者名（actorName）を localStorage に永続化するフック。
 * 全 write リクエストはこの actorName を必要とする。
 *
 * lazy initializer で localStorage を一度だけ読むため、effect 内での
 * setState（cascading render）を避けている。
 */
export function useActor(slug: string): UseActorResult {
  const [actorName, setActorName] = useState<string | null>(() => readActor(slug));
  const [ready] = useState<boolean>(() => typeof window !== "undefined");

  const setActor = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      try {
        window.localStorage.setItem(actorStorageKey(slug), trimmed);
      } catch {
        /* localStorage 不可環境では state のみ更新 */
      }
      setActorName(trimmed);
    },
    [slug],
  );

  const clearActor = useCallback(() => {
    try {
      window.localStorage.removeItem(actorStorageKey(slug));
    } catch {
      /* noop */
    }
    setActorName(null);
  }, [slug]);

  return { actorName, ready, setActor, clearActor };
}
