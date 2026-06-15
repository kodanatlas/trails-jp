"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";

interface Breadcrumb {
  label: string;
  href: string;
}

interface CarpoolHeaderProps {
  clubName: string;
  slug: string;
  breadcrumbs?: Breadcrumb[];
  currentPage?: string;
  maxWidth?: string;
  actions?: React.ReactNode;
}

/**
 * 配車画面共通のスティッキーヘッダー（パンくずナビ対応）。
 * 左: ← 戻るリンク（breadcrumbs の最後の要素）。
 * 右: 🚗 クラブ名 › 各パンくず › currentPage（太字・リンクなし）。
 * モバイルでパンくずが3つ以上ある場合は先頭と末尾のみ表示し … で省略。
 */
export default function CarpoolHeader({
  clubName,
  slug,
  breadcrumbs,
  currentPage,
  maxWidth = "max-w-2xl",
  actions,
}: CarpoolHeaderProps) {
  const hasBreadcrumbs = breadcrumbs && breadcrumbs.length > 0;
  const backCrumb = hasBreadcrumbs ? breadcrumbs[breadcrumbs.length - 1] : null;

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
      <div
        className={cn(
          "mx-auto flex items-center justify-between gap-2 px-4 py-3",
          maxWidth,
        )}
      >
        {/* Left: back button */}
        <div className="flex shrink-0 items-center">
          {backCrumb && (
            <Link
              href={backCrumb.href}
              className="text-sm text-muted-foreground hover:text-foreground"
              title={backCrumb.label}
            >
              ←
            </Link>
          )}
        </div>

        {/* Center: breadcrumb trail */}
        <nav className="flex min-w-0 flex-1 items-center justify-end gap-1 overflow-hidden">
          <Link
            href="/carpool"
            className="shrink-0 text-sm font-semibold text-foreground hover:text-primary"
            title="別のクラブを選ぶ"
          >
            🚗 {clubName}
          </Link>

          {hasBreadcrumbs && (
            <>
              {/* Full breadcrumbs — on mobile when > 2 items, hide all except first */}
              {breadcrumbs.map((crumb, i) => (
                <span
                  key={crumb.href}
                  className={cn(
                    "flex items-center gap-1",
                    breadcrumbs.length > 2 && i > 0 ? "hidden sm:flex" : "",
                  )}
                >
                  <span className="text-muted-foreground">›</span>
                  <Link
                    href={crumb.href}
                    className="truncate text-xs text-muted-foreground hover:text-primary"
                  >
                    {crumb.label}
                  </Link>
                </span>
              ))}
              {/* Ellipsis on mobile when > 2 items */}
              {breadcrumbs.length > 2 && (
                <span className="flex items-center gap-1 sm:hidden">
                  <span className="text-muted-foreground">›</span>
                  <span className="text-xs text-muted-foreground">…</span>
                  <span className="text-muted-foreground">›</span>
                  <Link
                    href={breadcrumbs[breadcrumbs.length - 1].href}
                    className="truncate text-xs text-muted-foreground hover:text-primary"
                  >
                    {breadcrumbs[breadcrumbs.length - 1].label}
                  </Link>
                </span>
              )}
            </>
          )}

          {currentPage && (
            <>
              <span className="text-muted-foreground">›</span>
              <span className="truncate text-xs font-semibold text-foreground">
                {currentPage}
              </span>
            </>
          )}
        </nav>

        {/* Right: optional actions */}
        {actions && (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        )}
      </div>
    </header>
  );
}
