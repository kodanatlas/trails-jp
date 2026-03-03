"use client";

import { useState, useEffect } from "react";
import { Heart } from "lucide-react";
import { getSessionId, getLikedAthletes, addLikedAthlete } from "@/lib/session";

interface LikeButtonProps {
  athleteName: string;
  initialCount?: number;
}

export function LikeButton({ athleteName, initialCount = 0 }: LikeButtonProps) {
  const [count, setCount] = useState(initialCount);
  const [liked, setLiked] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    setLiked(getLikedAthletes().has(athleteName));
  }, [athleteName]);

  useEffect(() => {
    setCount(initialCount);
  }, [initialCount]);

  const handleLike = async () => {
    if (liked || sending) return;
    setSending(true);

    try {
      const res = await fetch("/api/likes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          athleteName,
          sessionId: getSessionId(),
        }),
      });

      if (res.ok) {
        setCount((c) => c + 1);
        setLiked(true);
        addLikedAthlete(athleteName);
      } else if (res.status === 409) {
        // 既にいいね済み
        setLiked(true);
        addLikedAthlete(athleteName);
      }
    } catch {
      // ネットワークエラー — 静かに失敗
    } finally {
      setSending(false);
    }
  };

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        handleLike();
      }}
      disabled={liked || sending}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-all ${
        liked
          ? "bg-pink-500/15 text-pink-400"
          : "bg-surface text-muted hover:bg-pink-500/10 hover:text-pink-400"
      }`}
    >
      <Heart className={`h-3 w-3 ${liked ? "fill-pink-400" : ""}`} />
      {count > 0 && <span>{count}</span>}
    </button>
  );
}
