"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

/** トップ hero の選手検索。/analysis の検索ボックスへ ?q= で引き継ぐ。 */
export function HeroAthleteSearch({ size = "md" }: { size?: "md" | "lg" }) {
  const lg = size === "lg";
  const [q, setQ] = useState("");
  const router = useRouter();

  return (
    <form
      className={lg ? "relative mt-5" : "relative mt-8 max-w-xs"}
      onSubmit={(e) => {
        e.preventDefault();
        const v = q.trim();
        router.push(v ? `/analysis?q=${encodeURIComponent(v)}` : "/analysis");
      }}
    >
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="選手名で探す..."
        aria-label="選手を検索"
        enterKeyHint="search"
        className={`w-full rounded-lg border border-border-strong pl-9 pr-20 outline-none transition-colors placeholder:text-muted focus:border-primary ${lg ? "bg-surface py-4 text-base" : "bg-card py-2.5 text-sm"}`}
      />
      <button
        type="submit"
        className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md bg-primary px-3 py-1.5 text-xs font-bold text-background transition-colors hover:bg-primary-dark"
      >
        検索
      </button>
    </form>
  );
}
