"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Heart, PartyPopper } from "lucide-react";
import { getSessionId, hasCheeredGroup, setCheeredGroup } from "@/lib/session";

/* ─── 表示のみのハート（クリック不可） ─── */

interface LikeDisplayProps {
  count: number;
}

export function LikeDisplay({ count }: LikeDisplayProps) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-pink-500/15 px-2 py-0.5 text-[10px] font-medium text-pink-400">
      <Heart className="h-3 w-3 fill-pink-400" />
      {count > 0 && <span>{count}</span>}
    </span>
  );
}

/* ─── グループ応援ボタン ─── */

interface GroupCheerButtonProps {
  groupKey: "rising" | "falling";
  athleteNames: string[];
  onCheered: () => void;
}

export function GroupCheerButton({ groupKey, athleteNames, onCheered }: GroupCheerButtonProps) {
  const [cheered, setCheered] = useState(false);
  const [sending, setSending] = useState(false);
  const [showCelebration, setShowCelebration] = useState(false);

  useEffect(() => {
    setCheered(hasCheeredGroup(groupKey));
  }, [groupKey]);

  const handleCheer = () => {
    if (cheered || sending) return;
    setSending(true);
    setCheered(true);
    setCheeredGroup(groupKey);
    setShowCelebration(true);

    // APIはバックグラウンドで実行（アニメーションを即表示）
    fetch("/api/likes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        athleteNames,
        sessionId: getSessionId(),
      }),
    })
      .then(() => onCheered())
      .catch(() => {})
      .finally(() => setSending(false));
  };

  return (
    <>
      <button
        onClick={handleCheer}
        disabled={cheered || sending}
        className={`flex w-full items-center justify-center gap-2 rounded-lg border px-4 py-3 text-sm font-bold transition-all ${
          cheered
            ? "border-pink-500/20 bg-pink-500/10 text-pink-400"
            : "border-primary/30 bg-primary/10 text-primary hover:bg-primary/20"
        } ${sending ? "animate-pulse" : ""}`}
      >
        <PartyPopper className="h-5 w-5" />
        {cheered ? "応援済み！" : "みんなを応援する"}
      </button>
      {showCelebration &&
        createPortal(
          <GroupCelebrationOverlay
            athleteNames={athleteNames}
            onComplete={() => setShowCelebration(false)}
          />,
          document.body,
        )}
    </>
  );
}

/* ─── グループ応援アニメーション（全画面オーバーレイ） ─── */

function GroupCelebrationOverlay({
  athleteNames,
  onComplete,
}: {
  athleteNames: string[];
  onComplete: () => void;
}) {
  const [phase, setPhase] = useState<"enter" | "hold" | "exit">("enter");

  useEffect(() => {
    const t1 = setTimeout(() => setPhase("hold"), 50);
    const t2 = setTimeout(() => setPhase("exit"), 4400);
    const t3 = setTimeout(onComplete, 5000);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [onComplete]);

  const particles = useParticles(32);

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center pointer-events-none transition-opacity duration-500 ${
        phase === "enter" ? "opacity-0" : phase === "hold" ? "opacity-100" : "opacity-0"
      }`}
    >
      {/* 背景暗転 */}
      <div className="absolute inset-0 bg-black/50" />

      {/* パーティクル */}
      {particles.map((p, i) => (
        <span
          key={i}
          className="absolute text-2xl"
          style={{
            left: `${p.x}%`,
            top: `${p.y}%`,
            animation: `celebration-particle ${p.duration}s ease-out ${p.delay}s both`,
            fontSize: `${p.size}rem`,
          }}
        >
          {p.emoji}
        </span>
      ))}

      {/* 中央テキスト */}
      <div
        className={`relative z-10 text-center transition-all duration-700 ${
          phase === "hold" ? "scale-100 opacity-100" : "scale-50 opacity-0"
        }`}
      >
        <p className="text-5xl mb-3">
          <span className="inline-block animate-bounce">&#x1F389;</span>
        </p>
        <p className="text-2xl font-bold text-white drop-shadow-lg mb-4">
          フレーフレー！
        </p>

        {/* 選手名一覧 */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1.5 max-w-lg mx-auto px-4">
          {athleteNames.map((name, i) => (
            <p
              key={name}
              className="text-sm font-semibold text-pink-300 drop-shadow-lg whitespace-nowrap"
              style={{
                animation: `name-appear 0.4s ease-out ${0.1 + i * 0.05}s both`,
              }}
            >
              {name}
            </p>
          ))}
        </div>
      </div>

      {/* アニメーション CSS */}
      <style>{`
        @keyframes celebration-particle {
          0% {
            transform: translateY(0) scale(0) rotate(0deg);
            opacity: 0;
          }
          15% {
            opacity: 1;
            transform: translateY(-20px) scale(1) rotate(20deg);
          }
          100% {
            transform: translateY(-200px) scale(0.5) rotate(180deg);
            opacity: 0;
          }
        }
        @keyframes name-appear {
          0% {
            transform: scale(0) translateY(10px);
            opacity: 0;
          }
          100% {
            transform: scale(1) translateY(0);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
}

const EMOJIS = ["❤️", "🎉", "✨", "🔥", "💪", "⭐", "🏆", "🎊", "👏", "💖"];

function useParticles(count: number) {
  const [particles] = useState(() =>
    Array.from({ length: count }, () => ({
      x: 10 + Math.random() * 80,
      y: 20 + Math.random() * 60,
      emoji: EMOJIS[Math.floor(Math.random() * EMOJIS.length)],
      duration: 1.2 + Math.random() * 1.0,
      delay: Math.random() * 0.8,
      size: 1.2 + Math.random() * 1.0,
    }))
  );
  return particles;
}
