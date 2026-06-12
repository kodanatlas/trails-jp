"use client";

import Link from "next/link";

interface CarpoolHeaderProps {
  clubName: string;
  slug: string;
}

/**
 * 配車画面共通のスティッキーヘッダー（調整さんモデル: 操作者概念なし）。
 * 左: 🚗 クラブ名（タップで /carpool = クラブ選択へ）。
 * URL を開いた全員が同じデータを見て編集できる（操作者の切替 UI は廃止）。
 */
export default function CarpoolHeader({ clubName }: CarpoolHeaderProps) {
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
      </div>
    </header>
  );
}
