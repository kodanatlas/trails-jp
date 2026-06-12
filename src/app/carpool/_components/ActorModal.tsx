"use client";

import { useState, type FormEvent } from "react";
import type { MemberDTO } from "@/lib/carpool/api/mappers";

interface ActorModalProps {
  slug: string;
  members: MemberDTO[];
  onSelect: (name: string) => void;
  /** 任意: 閉じる動作（×やオーバーレイクリック）。省略時は閉じられない。 */
  onClose?: () => void;
}

/**
 * 「あなたは誰ですか？」モーダル。
 * メンバー一覧から選ぶか、テキスト入力で操作者名を確定する。
 */
export default function ActorModal({
  slug,
  members,
  onSelect,
  onClose,
}: ActorModalProps) {
  const [manual, setManual] = useState("");

  const handleManual = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = manual.trim();
    if (!trimmed) return;
    onSelect(trimmed);
  };

  const activeMembers = members.filter((m) => m.active);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="mx-4 max-h-[85vh] w-full max-w-sm overflow-y-auto rounded-xl bg-card p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="操作者の選択"
      >
        <h2 className="mb-1 text-base font-semibold text-foreground">
          あなたは誰ですか？
        </h2>
        <p className="mb-3 text-xs text-muted">
          記録に残す名前を選んでください（このクラブ: {slug}）。
        </p>

        {activeMembers.length > 0 && (
          <ul className="mb-4 flex flex-col gap-1">
            {activeMembers.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  className="w-full rounded-lg bg-surface px-3 py-2 text-left text-sm text-foreground hover:bg-card-hover"
                  onClick={() => onSelect(m.displayName)}
                >
                  {m.displayName}
                </button>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={handleManual} className="flex flex-col gap-2">
          <label className="text-xs text-muted" htmlFor="actor-manual">
            一覧に無い場合は入力
          </label>
          <input
            id="actor-manual"
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
            placeholder="お名前"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            maxLength={30}
          />
          <button
            type="submit"
            disabled={!manual.trim()}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark disabled:opacity-50"
          >
            入力して続ける
          </button>
        </form>
      </div>
    </div>
  );
}
