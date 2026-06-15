"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { fetchCarpool, postCarpool } from "./carpoolFetch";
import { useAthleteSuggest } from "./useAthleteSuggest";
import {
  athleteSelectionToFields,
  athleteKeyForSubmit,
} from "@/lib/carpool/suggest";
import type { MemberDTO, NodeDTO } from "@/lib/carpool/api/mappers";

interface AddMemberModalProps {
  slug: string;
  /** メンバーを新規作成して確定したときに呼ぶ。 */
  onCreated: (member: MemberDTO) => void;
  /** 閉じる動作（×やオーバーレイクリック・キャンセル）。 */
  onClose: () => void;
}

/**
 * 「メンバーを追加」モーダル（調整さんモデル: 操作者概念なし）。
 *
 * 表示名・車の有無・同乗可能人数・自宅エリア名（フリーテキスト）を入力し、
 * members API で member を作成して確定する。誰でもメンバーを追加できる。
 * actorName には作成する本人の displayName を流用する（change_log は「誰の行か」を記録）。
 */
export default function AddMemberModal({
  slug,
  onCreated,
  onClose,
}: AddMemberModalProps) {
  const [displayName, setDisplayName] = useState("");
  const [hasCar, setHasCar] = useState(false);
  const [seatsAvailable, setSeatsAvailable] = useState("");
  const [homeAreaName, setHomeAreaName] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // 再発防止 UX: 自宅エリアを名前ジオコーディングした結果、入力名と解決先が違った
  // （exact=false）ときに出す確認バナー。{ input, resolved, member }。
  // exact=true は静かに閉じる（バナーなし）。OK 押下で onCreated を確定して閉じる。
  const [geocodeNotice, setGeocodeNotice] = useState<{
    input: string;
    resolved: string;
    member: MemberDTO;
  } | null>(null);

  // major1: 自宅エリアのチップ候補（クラブの場所 = area / pickup ノード）。開いたとき1度だけ取得。
  // 0 件のクラブ（初期）はチップを出さずテキスト入力のみ（従来どおり）。
  const [areaNodes, setAreaNodes] = useState<NodeDTO[]>([]);
  const [areaOtherOpen, setAreaOtherOpen] = useState(false);
  const areaChipNames = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const n of areaNodes) {
      if (n.kind !== "area" && n.kind !== "pickup") continue;
      const name = n.name.trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      out.push(name);
    }
    return out.sort((a, b) => a.localeCompare(b, "ja"));
  }, [areaNodes]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetchCarpool<{ nodes: NodeDTO[] }>(`/clubs/${slug}/nodes`);
        if (alive) setAreaNodes(res.nodes);
      } catch {
        // 取得失敗時はチップ無し（テキスト入力のみ）で続行する。
        if (alive) setAreaNodes([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [slug]);

  // 氏名の正規候補サジェスト。候補選択で displayName=正規氏名・athleteKey を同時設定。
  // 自由入力も引き続き可（JOY 未出場者）。その場合はサーバ側の nameKey 自動付与がフォローする。
  const suggest = useAthleteSuggest();
  const [selectedAthlete, setSelectedAthlete] = useState<string | null>(null);

  const pickAthlete = (canonicalName: string) => {
    const fields = athleteSelectionToFields(canonicalName);
    setDisplayName(fields.displayName);
    setSelectedAthlete(fields.displayName);
    suggest.dismiss();
  };

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
      // 調整さんモデル: 作成する本人の displayName を actorName に流用する。
      actorName: name,
      displayName: name,
      hasCar,
    };
    // 候補選択済みかつ同一人物のままなら正規キーを明示送信（編集で別人になったら自動付与に委ねる）。
    const athleteKey = athleteKeyForSubmit(name, selectedAthlete);
    if (athleteKey) body.athleteKey = athleteKey;
    if (hasCar && seatsAvailable !== "") {
      body.seatsAvailable = Number(seatsAvailable);
    }
    const area = homeAreaName.trim();
    if (area) body.homeAreaName = area;

    try {
      const data = await postCarpool<{
        member: MemberDTO;
        geocode?: { resolvedTitle: string; exact: boolean } | null;
      }>(`/clubs/${slug}/members`, body);
      // 自宅エリアを名前ジオコーディングし、入力名と解決先が違ったら確認バナーを出して
      // ユーザーに気づかせてから閉じる。完全一致（または geocode 無し）は従来どおり即確定。
      if (data.geocode && data.geocode.exact === false) {
        setGeocodeNotice({
          input: area,
          resolved: data.geocode.resolvedTitle,
          member: data.member,
        });
      } else {
        onCreated(data.member);
      }
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
        aria-label="メンバーを追加"
      >
        <h2 className="mb-1 text-base font-semibold text-foreground">
          メンバーを追加
        </h2>
        <p className="mb-3 text-xs text-muted">
          メンバーの情報を登録します（あとで設定から変更できます）。
        </p>

        {geocodeNotice ? (
          // 再発防止 UX: 自宅エリアの解決先が入力名と違ったときの確認バナー（小さめ amber）。
          // 登録自体は成功している。OK で確定し、地図調整したいときはマスタの「場所」へ誘導する。
          <div className="flex flex-col gap-3">
            <div className="rounded-lg border border-yellow-400/60 bg-yellow-400/10 p-3 text-xs text-yellow-200">
              <p className="leading-relaxed">
                「<span className="font-semibold">{geocodeNotice.input}</span>」→「
                <span className="font-semibold">
                  {geocodeNotice.resolved || "別の地点"}
                </span>
                」に設定しました。違う場合はマスタの「場所」で地図調整できます。
              </p>
              <a
                href={`/carpool/${slug}/masters`}
                className="mt-2 inline-block text-yellow-100 underline hover:text-white"
              >
                マスタの「場所」を開く
              </a>
            </div>
            <button
              type="button"
              onClick={() => onCreated(geocodeNotice.member)}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark"
            >
              OK（このまま登録する）
            </button>
          </div>
        ) : (
        <form onSubmit={submitRegister} className="flex flex-col gap-3">
          <div>
            <label className="mb-1 block text-xs text-muted" htmlFor="add-member-name">
              お名前（表示名）
            </label>
            <input
              id="add-member-name"
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
              placeholder="例: 山田太郎"
              value={displayName}
              onChange={(e) => {
                setDisplayName(e.target.value);
                suggest.setQuery(e.target.value);
              }}
              maxLength={40}
              autoFocus
            />
            {suggest.results.length > 0 && (
              <ul className="mt-1 flex flex-col gap-1 rounded-lg bg-surface p-1">
                {suggest.results.map((a) => (
                  <li key={a.name}>
                    <button
                      type="button"
                      onClick={() => pickAthlete(a.name)}
                      className="w-full rounded px-2 py-1 text-left text-sm text-foreground hover:bg-card-hover"
                    >
                      {a.name}
                      {a.clubs.length > 0 && (
                        <span className="ml-2 text-xs text-muted">
                          {a.clubs.join(", ")}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-1 text-[10px] text-muted">
              候補から選ぶと JOY エントリーの自動検出が確実になります（一覧に無ければそのまま入力でOK）。
            </p>
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
                htmlFor="add-member-seats"
              >
                自分以外にあと何人乗せられますか？
              </label>
              <input
                id="add-member-seats"
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
            <label className="mb-1 block text-xs text-muted" htmlFor="add-member-area">
              自宅エリア（任意）
            </label>
            {/* major1: 登録済みの場所をチップで選ぶ。該当が無いときだけ「その他（入力）」で
                テキスト入力にフォールバック。クラブに場所が 0 件ならテキスト入力のみ。 */}
            {areaChipNames.length > 0 && !areaOtherOpen ? (
              <div className="flex flex-wrap gap-2">
                {areaChipNames.map((name) => {
                  const selected = homeAreaName.trim() === name;
                  return (
                    <button
                      key={name}
                      type="button"
                      onClick={() => setHomeAreaName(selected ? "" : name)}
                      className={`rounded-full px-3 py-1.5 text-xs ${
                        selected
                          ? "bg-primary text-white"
                          : "bg-surface text-foreground hover:bg-white/10"
                      }`}
                    >
                      {name}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => {
                    setAreaOtherOpen(true);
                    if (areaChipNames.includes(homeAreaName.trim())) setHomeAreaName("");
                  }}
                  className="rounded-full border border-dashed border-border px-3 py-1.5 text-xs text-muted hover:text-foreground"
                >
                  その他（入力）
                </button>
              </div>
            ) : (
              <div>
                <input
                  id="add-member-area"
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
                  placeholder="例: 八王子駅"
                  value={homeAreaName}
                  onChange={(e) => setHomeAreaName(e.target.value)}
                  maxLength={80}
                />
                {areaChipNames.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setAreaOtherOpen(false)}
                    className="mt-1 text-[10px] text-accent hover:underline"
                  >
                    一覧から選ぶ
                  </button>
                )}
              </div>
            )}
          </div>

          {formError && <p className="text-sm text-red-400">{formError}</p>}

          <button
            type="submit"
            disabled={saving || !displayName.trim()}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark disabled:opacity-50"
          >
            {saving ? "登録中…" : "この内容で登録する"}
          </button>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-white/10 px-4 py-2 text-sm text-foreground hover:bg-white/15"
          >
            キャンセル
          </button>
        </form>
        )}
      </div>
    </div>
  );
}
