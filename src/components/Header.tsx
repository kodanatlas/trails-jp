"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, X, Compass, MapPlus } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "ホーム" },
  { href: "/maps", label: "地図" },
  { href: "/tracking", label: "GPS追跡" },
  { href: "/events", label: "イベント" },
  { href: "/rankings", label: "ランキング" },
];

export function Header() {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 h-14 border-b border-white/10 bg-[#1a2332]">
      <div className="mx-auto flex h-full max-w-[1920px] items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2 text-lg font-bold text-white">
          <Compass className="h-5 w-5 text-[#f97316]" />
          <span>trails<span className="text-[#f97316]">.jp</span></span>
        </Link>

        <nav className="hidden gap-1 md:flex">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                pathname === item.href
                  ? "bg-white/15 text-white"
                  : "text-white/60 hover:bg-white/10 hover:text-white"
              )}
            >
              {item.label}
            </Link>
          ))}
          <Link
              href="/upload"
              className="ml-2 flex items-center gap-1 rounded-md bg-[#f97316]/20 px-3 py-1.5 text-sm font-medium text-[#f97316] transition-colors hover:bg-[#f97316]/30"
            >
              <MapPlus className="h-3.5 w-3.5" />
              O-map登録
            </Link>
        </nav>

        <button
          className="text-white/60 hover:text-white md:hidden"
          onClick={() => setIsOpen(!isOpen)}
          aria-label="メニュー"
        >
          {isOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {isOpen && (
        <nav className="border-t border-white/10 bg-[#1a2332] px-4 py-2 md:hidden">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "block rounded-md px-3 py-2 text-sm font-medium transition-colors",
                pathname === item.href
                  ? "bg-white/15 text-white"
                  : "text-white/60 hover:text-white"
              )}
              onClick={() => setIsOpen(false)}
            >
              {item.label}
            </Link>
          ))}
          <Link
            href="/upload"
            className="mt-1 flex items-center gap-1.5 rounded-md bg-[#f97316]/20 px-3 py-2 text-sm font-medium text-[#f97316]"
            onClick={() => setIsOpen(false)}
          >
            <MapPlus className="h-3.5 w-3.5" />
            O-map登録
          </Link>
        </nav>
      )}
    </header>
  );
}
