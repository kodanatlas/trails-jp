"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, X, Compass } from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./ThemeToggle";

const navItems = [
  { href: "/", label: "ホーム" },
  { href: "/events", label: "イベント" },
  { href: "/rankings", label: "ランキング" },
  { href: "/analysis", label: "選手分析" },
  { href: "/results", label: "結果分析" },
  // 期間限定（O-Ringen 2026）。大会後に削除する — docs/plans/2026-07-15_abroad_oringen.md
  { href: "/abroad", label: "海外遠征" },
];

export function Header() {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();

  // /docs/* は全画面スタンドアロン文書のためサイト chrome を出さない
  if (pathname?.startsWith("/docs/")) return null;

  return (
    <header className="sticky top-0 z-50 h-14 border-b border-border bg-card">
      <div className="mx-auto flex h-full max-w-[1920px] items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2 text-lg font-bold text-foreground">
          <Compass className="h-5 w-5 text-primary" />
          <span>trails<span className="text-primary">.jp</span></span>
        </Link>

        <div className="flex items-center gap-1">
          <nav className="hidden gap-1 md:flex">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  pathname === item.href
                    ? "bg-primary/15 text-primary"
                    : "text-muted hover:bg-card-hover hover:text-foreground"
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <ThemeToggle />

          <button
            className="text-muted transition-colors hover:text-foreground md:hidden"
            onClick={() => setIsOpen(!isOpen)}
            aria-label="メニュー"
          >
            {isOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {isOpen && (
        <nav className="border-t border-border bg-card px-4 py-2 md:hidden">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "block rounded-md px-3 py-2 text-sm font-medium transition-colors",
                pathname === item.href
                  ? "bg-primary/15 text-primary"
                  : "text-muted hover:text-foreground"
              )}
              onClick={() => setIsOpen(false)}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
