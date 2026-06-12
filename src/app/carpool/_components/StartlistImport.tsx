"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchCarpool,
  postCarpool,
  patchCarpool,
  CarpoolApiError,
} from "./carpoolFetch";
import { useToast } from "./Toast";
import { cn } from "@/lib/utils";
import type { MemberDTO, ParticipationDTO } from "./carpoolTypes";

/**
 * スタートリスト取込パネル（配車割 Phase 4）。
 *
 * 3 つの入力経路（発行書類から選択 / URL 貼付 / テキスト貼付）でスタートリストを
 * プレビューし、信頼度（confidence）つきの照合結果を編集してから既存参加へ反映する。
 * PlanClient（設定 aside）と ParticipationClient（大会情報部）の双方から開く自己完結パネル。
 *
 * API 契約（fetch 先は文字列 URL。import 依存はしない）:
 *  - GET    /clubs/{slug}/events/{eventId}/documents
 *  - POST   /clubs/{slug}/events/{eventId}/import-startlist  (apply:false=プレビュー / true=反映)
 *  - PATCH  /clubs/{slug}/events/{eventId}                   (url 取込時のみ startlistUrl 保存)
 */

interface StartlistImportProps {
  slug: string;
  eventId: string;
  /** change_log 記録用。スタートリスト取込はメンバー文脈を持たないため "guest" を渡す。 */
  actorName: string;
  members: MemberDTO[];
  /** 反映成功時に呼ぶ（親が participations を再取得する）。 */
  onApplied: () => void;
}

/** 発行書類 1 件（GET .../documents の戻り）。 */
interface JoeDocument {
  title: string;
  url: string;
}

interface DocumentsResponse {
  documents: JoeDocument[];
  message?: string;
}

type Confidence = "exact" | "surname" | "none";

/** プレビュー照合行（POST .../import-startlist apply:false の戻り）。 */
interface StartlistMatch {
  startTime: string;
  className: string;
  rawName: string;
  affiliation: string;
  memberId: string | null;
  confidence: Confidence;
}

interface PreviewResponse {
  matches: StartlistMatch[];
  message?: string;
}

/** 反映 override（ユーザーが表で編集した memberId 確定行のみ）。 */
interface ImportOverride {
  memberId: string;
  startTime?: string | null;
  className?: string | null;
}

interface ApplyResponse {
  updated: ParticipationDTO[];
  skipped: { rawName: string; className: string; reason: string }[];
}

/** 入力経路。 */
type SourceMode = "documents" | "url" | "text";

/** プレビュー表で行ごとに保持する編集後の値。 */
interface RowEdit {
  className: string;
  startTime: string;
}

const CONFIDENCE_BADGE: Record<
  Confidence,
  { label: string; className: string }
> = {
  exact: { label: "完全一致", className: "bg-green-500/20 text-green-400" },
  surname: { label: "姓のみ一致", className: "bg-yellow-500/20 text-yellow-400" },
  none: { label: "不一致", className: "bg-white/10 text-muted" },
};

/** "HH:MM" 形式の緩いバリデーション（空は許容＝未指定）。 */
function isValidHHMM(v: string): boolean {
  if (v.trim() === "") return true;
  return /^([01]?\d|2[0-3]):[0-5]\d$/.test(v.trim());
}

/** rowKey: match は順序保証なしの可能性があるため index 併用で安定キーを作る。 */
function rowKey(m: StartlistMatch, i: number): string {
  return `${i}:${m.rawName}:${m.startTime}`;
}

export default function StartlistImport({
  slug,
  eventId,
  actorName,
  members,
  onApplied,
}: StartlistImportProps) {
  const { toast, toastEl } = useToast();

  const [open, setOpen] = useState(false);

  // --- 入力経路 ---
  const [mode, setMode] = useState<SourceMode>("documents");
  const [documents, setDocuments] = useState<JoeDocument[]>([]);
  const [documentsMessage, setDocumentsMessage] = useState<string | null>(null);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [selectedDocUrl, setSelectedDocUrl] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [textInput, setTextInput] = useState("");

  // --- プレビュー ---
  const [matches, setMatches] = useState<StartlistMatch[]>([]);
  const [previewMessage, setPreviewMessage] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  // M2: プレビュー成功時のソースのスナップショット。apply はこれを送信する
  // （入力欄の現在値は使わない。プレビューと異なるソースでの反映を防ぐ）。
  const [previewedSource, setPreviewedSource] = useState<
    { url: string; pastedText?: undefined } | { url?: undefined; pastedText: string } | null
  >(null);
  const [edits, setEdits] = useState<Record<string, RowEdit>>({});
  // M1: surname（姓のみ一致）行の「この行を反映する」確認チェック（rowKey 単位）。
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});

  // --- 反映 ---
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ApplyResponse | null>(null);

  // 開封時に発行書類を取得（1 回）。失敗してもパネルは壊さない。
  const loadDocuments = useCallback(async () => {
    setDocumentsLoading(true);
    setDocumentsMessage(null);
    try {
      const res = await fetchCarpool<DocumentsResponse>(
        `/clubs/${slug}/events/${eventId}/documents`,
      );
      setDocuments(res.documents ?? []);
      setDocumentsMessage(res.message ?? null);
    } catch (e) {
      setDocuments([]);
      setDocumentsMessage(
        e instanceof CarpoolApiError
          ? e.message
          : "発行書類の取得に失敗しました",
      );
    } finally {
      setDocumentsLoading(false);
    }
  }, [slug, eventId]);

  useEffect(() => {
    if (open && documents.length === 0 && !documentsLoading && !documentsMessage) {
      void loadDocuments();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /**
   * 入力経路（タブ・URL・テキスト・書類選択）が変わったらプレビュー結果を無効化し、
   * 再プレビューを強制する（M2: スナップショットと画面表示の不整合を防ぐ）。
   */
  function invalidatePreview() {
    setMatches([]);
    setEdits({});
    setConfirmed({});
    setSummary(null);
    setPreviewedSource(null);
    setApplyError(null);
    setPreviewMessage(null);
    setPreviewError(null);
  }

  /** 現在の入力経路から { url? , pastedText? } を導出（排他）。未入力なら null。 */
  function resolveSource():
    | { url: string; pastedText?: undefined }
    | { url?: undefined; pastedText: string }
    | null {
    if (mode === "documents") {
      if (!selectedDocUrl) return null;
      return { url: selectedDocUrl };
    }
    if (mode === "url") {
      const u = urlInput.trim();
      if (!u) return null;
      return { url: u };
    }
    const t = textInput.trim();
    if (!t) return null;
    return { pastedText: t };
  }

  const handlePreview = useCallback(async () => {
    const source = resolveSource();
    if (!source) {
      setPreviewError("取込元（書類・URL・テキストのいずれか）を指定してください。");
      return;
    }
    setPreviewing(true);
    setPreviewError(null);
    setPreviewMessage(null);
    setSummary(null);
    setApplyError(null);
    try {
      const res = await postCarpool<PreviewResponse>(
        `/clubs/${slug}/events/${eventId}/import-startlist`,
        { actorName, ...source, apply: false },
      );
      setMatches(res.matches ?? []);
      setPreviewMessage(res.message ?? null);
      setEdits({});
      setConfirmed({});
      // M2: 反映時はこのスナップショットを送信（url 取込なら startlistUrl 保存にも使う）。
      setPreviewedSource(source);
    } catch (e) {
      setMatches([]);
      setPreviewError(
        e instanceof CarpoolApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : "プレビューの取得に失敗しました",
      );
    } finally {
      setPreviewing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, eventId, actorName, mode, selectedDocUrl, urlInput, textInput]);

  /** 行の編集値（編集されていなければ match 由来の初期値）。 */
  function editFor(m: StartlistMatch, i: number): RowEdit {
    const key = rowKey(m, i);
    return edits[key] ?? { className: m.className, startTime: m.startTime };
  }

  function setEdit(m: StartlistMatch, i: number, patch: Partial<RowEdit>) {
    const key = rowKey(m, i);
    setEdits((prev) => {
      const base = prev[key] ?? { className: m.className, startTime: m.startTime };
      return { ...prev, [key]: { ...base, ...patch } };
    });
  }

  /**
   * 反映 override を構築（memberId 確定行＝null 以外のみ）。
   *  - exact 行: 編集された値だけ送る（B1: 未編集の空値は API 側で「列を触らない」になる）。
   *  - surname 行（M1）: 「この行を反映する」チェック済みの行のみ、両列とも現在値で送る
   *    （API は override の有無を「ユーザー確認」とみなして反映する）。
   */
  function buildOverrides(): ImportOverride[] {
    const out: ImportOverride[] = [];
    matches.forEach((m, i) => {
      if (!m.memberId) return; // none 行は反映対象外
      const key = rowKey(m, i);
      const e = edits[key];
      if (m.confidence === "surname") {
        if (!confirmed[key]) return; // 未確認の surname 行は反映しない
        const cur = e ?? { className: m.className, startTime: m.startTime };
        out.push({
          memberId: m.memberId,
          className: cur.className.trim() || null,
          startTime: cur.startTime.trim() || null,
        });
        return;
      }
      if (!e) return; // 未編集行は match のまま反映（override 不要）
      const override: ImportOverride = { memberId: m.memberId };
      if (e.className !== m.className) override.className = e.className.trim() || null;
      if (e.startTime !== m.startTime) override.startTime = e.startTime.trim() || null;
      // memberId だけで中身が変わっていなければ送らない。
      if (override.className !== undefined || override.startTime !== undefined) {
        out.push(override);
      }
    });
    return out;
  }

  /** 行が反映対象か（exact は常に・surname は確認チェック済みのみ・none は対象外）。 */
  function isApplyTarget(m: StartlistMatch, i: number): boolean {
    if (!m.memberId) return false;
    if (m.confidence === "surname") return !!confirmed[rowKey(m, i)];
    return true;
  }

  const editsHaveInvalidTime = matches.some((m, i) => {
    if (!isApplyTarget(m, i)) return false;
    return !isValidHHMM(editFor(m, i).startTime);
  });

  const targetCount = matches.filter((m, i) => isApplyTarget(m, i)).length;

  const handleApply = useCallback(async () => {
    // M2: プレビュー時のスナップショットを送信する（入力欄の現在値は使わない）。
    if (!previewedSource) {
      setApplyError("プレビューを実行してから反映してください。");
      return;
    }
    if (editsHaveInvalidTime) {
      setApplyError("スタート時刻は HH:MM 形式で入力してください。");
      return;
    }
    setApplying(true);
    setApplyError(null);
    try {
      const overrides = buildOverrides();
      const res = await postCarpool<ApplyResponse>(
        `/clubs/${slug}/events/${eventId}/import-startlist`,
        {
          actorName,
          ...previewedSource,
          apply: true,
          ...(overrides.length > 0 ? { overrides } : {}),
        },
      );
      setSummary(res);

      // url 取込時のみ startlist_url を保存（貼付時は保存しない）。
      const sourceUrl = previewedSource.url ?? null;

      // m1: 二重反映防止 — プレビュー表を畳み、summary だけ残す（再反映には再プレビュー必須）。
      setMatches([]);
      setEdits({});
      setConfirmed({});
      setPreviewedSource(null);

      if (sourceUrl) {
        try {
          await patchCarpool(`/clubs/${slug}/events/${eventId}`, {
            actorName,
            startlistUrl: sourceUrl,
          });
        } catch {
          // URL 保存の失敗は反映自体を無効にしない（参加への反映は成功済み）。
        }
      }

      toast(
        `${res.updated.length}人に反映、${res.skipped.length}人スキップ`,
        "success",
      );
      onApplied();
    } catch (e) {
      setApplyError(
        e instanceof CarpoolApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : "反映に失敗しました",
      );
    } finally {
      setApplying(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    slug,
    eventId,
    actorName,
    matches,
    edits,
    confirmed,
    previewedSource,
    editsHaveInvalidTime,
  ]);

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      {toastEl}
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="text-sm font-semibold text-foreground">
          スタートリスト取込
        </span>
        <span className="text-xs text-muted">{open ? "閉じる" : "開く"}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-4">
          {/* 入力経路タブ */}
          <div className="flex rounded-lg border border-border bg-surface p-0.5 text-xs">
            {(
              [
                { key: "documents", label: "発行書類" },
                { key: "url", label: "URL 貼付" },
                { key: "text", label: "テキスト貼付" },
              ] as { key: SourceMode; label: string }[]
            ).map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => {
                  if (mode === t.key) return;
                  setMode(t.key);
                  invalidatePreview();
                }}
                className={cn(
                  "flex-1 rounded-md px-2 py-1.5 font-medium",
                  mode === t.key
                    ? "bg-primary text-white"
                    : "text-muted hover:text-foreground",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* 経路 1: 発行書類から選択 */}
          {mode === "documents" && (
            <div className="space-y-2">
              {documentsLoading && (
                <p className="text-xs text-muted">発行書類を取得中…</p>
              )}
              {documentsMessage && (
                <p className="text-xs text-muted">{documentsMessage}</p>
              )}
              {!documentsLoading && documents.length === 0 && !documentsMessage && (
                <p className="text-xs text-muted">発行書類が見つかりません。</p>
              )}
              {documents.length > 0 && (
                <ul className="flex flex-col gap-1.5">
                  {documents.map((doc) => (
                    <li key={doc.url}>
                      <button
                        type="button"
                        onClick={() => {
                          if (selectedDocUrl === doc.url) return;
                          setSelectedDocUrl(doc.url);
                          invalidatePreview();
                        }}
                        className={cn(
                          "w-full truncate rounded-lg border px-3 py-1.5 text-left text-xs",
                          selectedDocUrl === doc.url
                            ? "border-primary bg-primary/10 text-foreground"
                            : "border-border text-muted hover:text-foreground",
                        )}
                        title={doc.title}
                      >
                        {doc.title}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                onClick={() => void loadDocuments()}
                disabled={documentsLoading}
                className="text-[11px] text-primary hover:underline disabled:opacity-50"
              >
                発行書類を再取得
              </button>
            </div>
          )}

          {/* 経路 2: URL 貼付 */}
          {mode === "url" && (
            <div className="space-y-1">
              <label className="block text-xs text-muted">
                スタートリストの URL（PDF / ページ）
              </label>
              <input
                type="url"
                value={urlInput}
                onChange={(e) => {
                  setUrlInput(e.target.value);
                  invalidatePreview();
                }}
                placeholder="https://japan-o-entry.com/…"
                className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-foreground placeholder:text-muted"
              />
              <p className="text-[11px] text-muted">
                取り込めるのは japan-o-entry.com の URL のみです。
              </p>
            </div>
          )}

          {/* 経路 3: テキスト貼付 */}
          {mode === "text" && (
            <div className="space-y-1">
              <label className="block text-xs text-muted">
                スタートリスト本文を貼り付け
              </label>
              <textarea
                value={textInput}
                onChange={(e) => {
                  setTextInput(e.target.value);
                  invalidatePreview();
                }}
                rows={6}
                placeholder="氏名 / クラス / スタート時刻 を含む本文…"
                className="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted"
              />
              <p className="text-[11px] text-muted">
                貼付取込ではスタートリスト URL は保存されません。
              </p>
            </div>
          )}

          {/* プレビューボタン */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handlePreview()}
              disabled={previewing}
              className="rounded-lg bg-white/10 px-4 py-2 text-xs font-medium text-foreground hover:bg-white/15 disabled:opacity-50"
            >
              {previewing ? "プレビュー中…" : "プレビュー"}
            </button>
          </div>

          {previewError && (
            <p className="text-xs text-red-400">{previewError}</p>
          )}
          {previewMessage && (
            <p className="text-xs text-muted">{previewMessage}</p>
          )}

          {/* プレビュー表 */}
          {matches.length > 0 && (
            <div className="space-y-3">
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[36rem] text-left text-xs">
                  <thead>
                    <tr className="border-b border-border text-muted">
                      <th className="px-2 py-1.5 font-medium">信頼度</th>
                      <th className="px-2 py-1.5 font-medium">氏名</th>
                      <th className="px-2 py-1.5 font-medium">クラス</th>
                      <th className="px-2 py-1.5 font-medium">スタート</th>
                      <th className="px-2 py-1.5 font-medium">対象メンバー</th>
                    </tr>
                  </thead>
                  <tbody>
                    {matches.map((m, i) => {
                      const key = rowKey(m, i);
                      const badge = CONFIDENCE_BADGE[m.confidence];
                      const isNone = !m.memberId;
                      const isSurname = m.confidence === "surname";
                      const applyTarget = isApplyTarget(m, i);
                      const target = m.memberId
                        ? (members.find((mem) => mem.id === m.memberId)
                            ?.displayName ?? m.rawName)
                        : null;
                      const e = editFor(m, i);
                      const timeInvalid = applyTarget && !isValidHHMM(e.startTime);
                      // m4 / B1: 時刻が空の反映対象行の扱いを可視化する。
                      //  - 編集で空にした（exact 行で match は非空）/ surname 確認行が空
                      //    → override null が送られ「明示クリア」になる。
                      //  - match が元々空で未編集 → 列は更新されない（既存の手入力値を保持）。
                      const timeEmpty = e.startTime.trim() === "";
                      const timeWillClear =
                        applyTarget &&
                        timeEmpty &&
                        (isSurname || e.startTime !== m.startTime);
                      const timeNotApplied = applyTarget && timeEmpty && !timeWillClear;
                      return (
                        <tr
                          key={key}
                          className={cn(
                            "border-b border-border/60 align-top",
                            isNone && "opacity-50",
                          )}
                        >
                          <td className="px-2 py-1.5">
                            <span
                              className={cn(
                                "inline-block rounded px-1.5 py-0.5 text-[10px] font-medium",
                                badge.className,
                              )}
                            >
                              {badge.label}
                            </span>
                          </td>
                          <td className="px-2 py-1.5">
                            <span className="text-foreground">{m.rawName}</span>
                            {m.affiliation && (
                              <span className="block text-[10px] text-muted">
                                {m.affiliation}
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-1.5">
                            <input
                              type="text"
                              value={e.className}
                              disabled={isNone}
                              onChange={(ev) =>
                                setEdit(m, i, { className: ev.target.value })
                              }
                              className="w-20 rounded border border-border bg-surface px-1.5 py-1 text-xs text-foreground disabled:opacity-60"
                            />
                          </td>
                          <td className="px-2 py-1.5">
                            <input
                              type="text"
                              value={e.startTime}
                              disabled={isNone}
                              onChange={(ev) =>
                                setEdit(m, i, { startTime: ev.target.value })
                              }
                              placeholder="HH:MM"
                              className={cn(
                                "w-16 rounded border bg-surface px-1.5 py-1 text-xs text-foreground disabled:opacity-60",
                                timeInvalid
                                  ? "border-red-500/60"
                                  : timeNotApplied
                                    ? "border-yellow-500/60 bg-yellow-500/10"
                                    : "border-border",
                              )}
                            />
                            {timeNotApplied && (
                              <span className="block text-[10px] text-yellow-400">
                                時刻が空のため反映されません
                              </span>
                            )}
                            {timeWillClear && (
                              <span className="block text-[10px] text-muted">
                                時刻をクリアします
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-1.5">
                            {isNone ? (
                              <span className="text-[11px] text-muted">
                                メンバー未特定
                              </span>
                            ) : (
                              <>
                                <span className="text-foreground">{target}</span>
                                {isSurname && (
                                  <label className="mt-1 flex items-center gap-1 text-[10px] text-yellow-400">
                                    <input
                                      type="checkbox"
                                      checked={!!confirmed[key]}
                                      onChange={(ev) =>
                                        setConfirmed((prev) => ({
                                          ...prev,
                                          [key]: ev.target.checked,
                                        }))
                                      }
                                    />
                                    この行を反映する
                                  </label>
                                )}
                              </>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <p className="text-[11px] text-muted">
                淡色行（メンバー未特定）は反映されません。姓のみ一致の行は「この行を反映する」に
                チェックを入れた場合のみ反映されます（同姓の取り違えに注意）。
              </p>

              {applyError && (
                <p className="text-xs text-red-400">{applyError}</p>
              )}

              <button
                type="button"
                onClick={() => void handleApply()}
                disabled={applying || targetCount === 0}
                className="rounded-lg bg-primary px-4 py-2 text-xs font-medium text-white hover:bg-primary-dark disabled:opacity-50"
              >
                {applying
                  ? "反映中…"
                  : `反映する（${targetCount}人）`}
              </button>
            </div>
          )}

          {/* 反映サマリ */}
          {summary && (
            <div className="rounded-lg border border-border bg-surface p-3 text-xs">
              <p className="text-foreground">
                {summary.updated.length}人に反映、{summary.skipped.length}
                人スキップしました。
              </p>
              {summary.skipped.length > 0 && (
                <ul className="mt-1.5 flex flex-col gap-0.5 text-muted">
                  {summary.skipped.map((s, i) => (
                    <li key={`${s.rawName}:${i}`}>
                      {s.rawName}（{s.className}）: {s.reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
