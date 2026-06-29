"use client";

import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";

type Theme = "dark" | "light";

/** ダーク/ライト切替トグル。<html data-theme> を切替え localStorage に保存。
 *  初期値は layout のフラッシュ防止スクリプトが設定済みの data-theme から読む。 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const cur = (document.documentElement.getAttribute("data-theme") as Theme) || "dark";
    setTheme(cur);
    setMounted(true);
  }, []);

  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("theme", next);
    } catch {
      // localStorage 不可環境は無視
    }
  };

  return (
    <button
      onClick={toggle}
      aria-label={theme === "dark" ? "ライトモードに切替" : "ダークモードに切替"}
      title={theme === "dark" ? "ライトモード" : "ダークモード"}
      className="rounded-md p-2 text-muted transition-colors hover:bg-card-hover hover:text-foreground"
    >
      {/* mounted 前は SSR と一致させるためダーク既定のアイコン（Sun=ライトへ） */}
      {mounted && theme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
    </button>
  );
}
