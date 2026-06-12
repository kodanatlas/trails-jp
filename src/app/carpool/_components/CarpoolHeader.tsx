"use client";

import { useEffect } from "react";
import Link from "next/link";
import { rememberClub } from "./storageKeys";

interface CarpoolHeaderProps {
  clubName: string;
  slug: string;
  actorName: string | null;
  /** 「切替」押下で操作者選択をやり直す。 */
  onActorChange: () => void;
}

/**
 * 配車画面共通のスティッキーヘッダー。
 * 左: 🚗 クラブ名（タップで /carpool = クラブ選択へ。自動遷移は廃止済みのため常に一覧が出る）。
 * 右: 操作者名 + 切替。
 * クラブ配下ページの訪問時に carpool.club を保存する（「前回のクラブを開く」ショートカット用）。
 */
export default function CarpoolHeader({
  clubName,
  slug,
  actorName,
  onActorChange,
}: CarpoolHeaderProps) {
  // 外部システム（localStorage）への同期のみ。setState しないので lint 安全。
  useEffect(() => {
    rememberClub(slug);
  }, [slug]);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-2xl items-center justify-between gap-2 px-4 py-3">
        <Link
          href="/carpool"
          className="truncate text-sm font-semibold text-foreground hover:text-primary"
          title="別のクラブを選ぶ"
        >
          🚗 {clubName}
        </Link>
        <div className="flex shrink-0 items-center gap-2">
          {actorName ? (
            <span className="max-w-[8rem] truncate text-xs text-muted">
              {actorName}
            </span>
          ) : (
            <span className="text-xs text-muted">未設定</span>
          )}
          <button
            type="button"
            onClick={onActorChange}
            className="rounded-lg bg-white/10 px-2.5 py-1 text-xs text-foreground hover:bg-white/15"
          >
            切替
          </button>
        </div>
      </div>
    </header>
  );
}
