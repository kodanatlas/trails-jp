"use client";

import { useState, type FormEvent } from "react";
import { postCarpool } from "./carpoolFetch";
import type { MemberDTO } from "@/lib/carpool/api/mappers";

interface ActorModalProps {
  slug: string;
  members: MemberDTO[];
  /** member を選択/新規作成して確定したときに呼ぶ。 */
  onSelectMember: (member: MemberDTO) => void;
  /** 現在の操作者名（ヘッダ表示用・任意）。 */
  actorName?: string | null;
  /** 任意: 閉じる動作（×やオーバーレイクリック）。省略時は閉じられない。 */
  onClose?: () => void;
}

/**
 * 「あなたは誰ですか？」モーダル（操作者 = member 化後の再設計）。
 *
 * 2 モード:
 *   (1) メンバー一覧から選ぶ（active のみ）。
 *   (2) 「自分を登録する」最小フォーム（メンバー0人や一覧に居ない場合の主導線）。
 *       表示名・車の有無・同乗可能人数・自宅エリア名（フリーテキスト）を入力し、
 *       members API で member を作成して確定する。ノード概念は homeAreaName が隠す。
 *
 * 旧「名前だけ確定」フォールバックは廃止（名前だけ入れて何も作られない罠を消す）。
 */
export default function ActorModal({
  slug,
  members,
  onSelectMember,
  onClose,
}: ActorModalProps) {
  const activeMembers = members.filter((m) => m.active);

  // メンバーが0人なら最初から自己登録フォームを開く。
  const [mode, setMode] = useState<"list" | "register">(
    activeMembers.length === 0 ? "register" : "list",
  );

  // 自己登録フォーム
  const [displayName, setDisplayName] = useState("");
  const [hasCar, setHasCar] = useState(false);
  const [seatsAvailable, setSeatsAvailable] = useState("");
  const [homeAreaName, setHomeAreaName] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const submitRegister = async (e: FormEvent) => {
    e.preventDefault();
    const name = displayName.trim();
    if (!name) {
      setFormError("お名前を入力してください");
      return;
    }
    setSaving(true);
    setFormError(null);

    const body: Record<string, unknown> = {
      // 自己登録なので作成する本人の displayName を actorName に流用する。
      actorName: name,
      displayName: name,
      hasCar,
    };
    if (hasCar && seatsAvailable !== "") {
      body.seatsAvailable = Number(seatsAvailable);
    }
    const area = homeAreaName.trim();
    if (area) body.homeAreaName = area;

    try {
      const data = await postCarpool<{ member: MemberDTO }>(
        `/clubs/${slug}/members`,
        body,
      );
      onSelectMember(data.member);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "登録に失敗しました");
    } finally {
      setSaving(false);
    }
  };

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
          記録に残すメンバーを選んでください（このクラブ: {slug}）。
        </p>

        {mode === "list" && activeMembers.length > 0 && (
          <>
            <ul className="mb-4 flex flex-col gap-1">
              {activeMembers.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    className="w-full rounded-lg bg-surface px-3 py-2 text-left text-sm text-foreground hover:bg-card-hover"
                    onClick={() => onSelectMember(m)}
                  >
                    {m.displayName}
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => setMode("register")}
              className="w-full rounded-lg bg-white/10 px-4 py-2 text-sm text-foreground hover:bg-white/15"
            >
              一覧に居ない → 自分を登録する
            </button>
          </>
        )}

        {mode === "register" && (
          <form onSubmit={submitRegister} className="flex flex-col gap-3">
            <p className="text-xs text-muted">
              あなたの情報を登録します（あとで設定から変更できます）。
            </p>
            <div>
              <label className="mb-1 block text-xs text-muted" htmlFor="actor-name">
                お名前（表示名）
              </label>
              <input
                id="actor-name"
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
                placeholder="例: 山田太郎"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={40}
                autoFocus
              />
            </div>

            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={hasCar}
                onChange={(e) => setHasCar(e.target.checked)}
              />
              車を出せる（運転手になりうる）
            </label>

            {hasCar && (
              <div>
                <label
                  className="mb-1 block text-xs text-muted"
                  htmlFor="actor-seats"
                >
                  自分以外にあと何人乗せられますか？
                </label>
                <input
                  id="actor-seats"
                  type="number"
                  min={0}
                  max={20}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
                  value={seatsAvailable}
                  onChange={(e) => setSeatsAvailable(e.target.value)}
                />
              </div>
            )}

            <div>
              <label className="mb-1 block text-xs text-muted" htmlFor="actor-area">
                自宅エリア（任意）
              </label>
              <input
                id="actor-area"
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
                placeholder="例: 八王子駅"
                value={homeAreaName}
                onChange={(e) => setHomeAreaName(e.target.value)}
                maxLength={80}
              />
            </div>

            {formError && <p className="text-sm text-red-400">{formError}</p>}

            <button
              type="submit"
              disabled={saving || !displayName.trim()}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark disabled:opacity-50"
            >
              {saving ? "登録中…" : "この内容で登録する"}
            </button>

            {activeMembers.length > 0 && (
              <button
                type="button"
                onClick={() => setMode("list")}
                className="rounded-lg bg-white/10 px-4 py-2 text-sm text-foreground hover:bg-white/15"
              >
                一覧から選ぶ
              </button>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
