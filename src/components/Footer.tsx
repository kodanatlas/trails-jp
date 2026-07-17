"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function Footer() {
  const pathname = usePathname();

  // /docs/* は全画面スタンドアロン文書のためサイト chrome を出さない
  if (pathname?.startsWith("/docs/")) return null;

  return (
    <footer className="border-t border-border bg-card">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-4 py-6 text-xs text-muted sm:flex-row sm:justify-between">
        <p>&copy; 2026 trails.jp</p>
        <div className="flex gap-6">
          <Link href="/about" className="transition-colors hover:text-foreground">
            このサイトについて
          </Link>
          <Link href="/contact" className="transition-colors hover:text-foreground">
            お問い合わせ
          </Link>
        </div>
      </div>
    </footer>
  );
}
