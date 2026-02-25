"use client";

import { useState, useCallback } from "react";
import { Upload, ImageIcon, FileText, MapPin, Check, ArrowLeft, ArrowRight, X, User, AlertTriangle } from "lucide-react";
import { PREFECTURES, TERRAIN_LABELS } from "@/lib/utils";
import { getCurrentUser } from "@/components/AuthGuard";
import type { Visibility } from "@/types/user";

type Step = 1 | 2 | 3;

const STEPS = [
  { num: 1, label: "画像", icon: ImageIcon },
  { num: 2, label: "情報入力", icon: FileText },
  { num: 3, label: "位置合わせ", icon: MapPin },
] as const;

const SCALES = ["1:4000", "1:5000", "1:7500", "1:10000", "1:15000"] as const;
const CONTOURS = [1, 2, 2.5, 5, 10] as const;

const VISIBILITY_OPTIONS: { key: Visibility; label: string; desc: string }[] = [
  { key: "full", label: "全体公開", desc: "高解像度画像を全ユーザーに公開" },
  { key: "low_res", label: "低解像度のみ公開", desc: "サムネイルとポリゴンを公開。高解像度は許可制" },
  { key: "polygon_only", label: "ポリゴンのみ公開", desc: "地図の範囲と基本情報のみ。画像は非公開" },
];

export function UploadWizard() {
  const [step, setStep] = useState<Step>(1);

  // Step 1
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageDimensions, setImageDimensions] = useState<{ w: number; h: number } | null>(null);
  const [imageError, setImageError] = useState("");
  const [dragOver, setDragOver] = useState(false);

  // Step 2
  const [name, setName] = useState("");
  const [prefecture, setPrefecture] = useState("");
  const [city, setCity] = useState("");
  const [terrainType, setTerrainType] = useState("");
  const [scale, setScale] = useState("1:10000");
  const [contour, setContour] = useState(2.5);
  const [createdYear, setCreatedYear] = useState(new Date().getFullYear());
  const [description, setDescription] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [visibility, setVisibility] = useState<Visibility>("full");

  // Step 3
  const [skipGeoref, setSkipGeoref] = useState(false);

  // Submission
  const [submitted, setSubmitted] = useState(false);

  const MIN_LONG_SIDE = 2000; // デジタルO-mapの最低長辺ピクセル

  const handleFileSelect = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) {
      setImageError("画像ファイルを選択してください");
      return;
    }
    setImageError("");
    setImageFile(file);

    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      setImagePreview(dataUrl);

      // 解像度チェック
      const img = new Image();
      img.onload = () => {
        const longSide = Math.max(img.width, img.height);
        setImageDimensions({ w: img.width, h: img.height });
        if (longSide < MIN_LONG_SIDE) {
          setImageError(
            `画像の解像度が低すぎます（${img.width}×${img.height}px）。O-mapの元データ（デジタルファイル）を使用してください。写真撮影やスクリーンショットは登録できません。長辺${MIN_LONG_SIDE}px以上が必要です`
          );
        }
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFileSelect(file);
    },
    [handleFileSelect]
  );

  const addTag = () => {
    const t = tagInput.trim();
    if (t && !tags.includes(t)) {
      setTags([...tags, t]);
    }
    setTagInput("");
  };

  const step2Valid = name && prefecture && city && terrainType;

  const handleSubmit = () => {
    // In real implementation: POST to API
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className="py-20 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-500/20">
          <Check className="h-8 w-8 text-green-400" />
        </div>
        <h2 className="text-xl font-bold">O-mapを登録しました</h2>
        <p className="mt-2 text-sm text-muted">
          管理者のレビュー後に公開されます。結果はメールでお知らせします
        </p>
        <p className="mt-1 text-xs text-muted">
          通常1〜3営業日以内にレビューが完了します
        </p>
        <a
          href="/maps"
          className="mt-6 inline-block rounded-lg bg-primary px-6 py-2 text-sm font-medium text-white hover:bg-primary-dark"
        >
          地図データベースに戻る
        </a>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold">O-map登録</h1>
        <p className="mt-1 text-sm text-muted">
          オリエンテーリング地図（O-map）をデータベースに登録して共有しましょう
        </p>
        {(() => {
          const u = getCurrentUser();
          return u ? (
            <div className="mt-2 flex items-center gap-1.5 text-xs text-muted">
              <User className="h-3 w-3" />
              <span>登録者: <span className="font-medium text-foreground">{u.displayName}</span></span>
            </div>
          ) : null;
        })()}
      </div>

      {/* Step indicator */}
      <div className="mb-8 flex items-center justify-center gap-1">
        {STEPS.map((s, i) => (
          <div key={s.num} className="flex items-center">
            <button
              onClick={() => {
                if (s.num === 1 || (s.num === 2 && imageFile) || (s.num === 3 && step2Valid)) {
                  setStep(s.num as Step);
                }
              }}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                step === s.num
                  ? "bg-primary text-white"
                  : step > s.num
                  ? "bg-primary/20 text-primary"
                  : "bg-white/5 text-muted"
              }`}
            >
              <s.icon className="h-3.5 w-3.5" />
              {s.label}
            </button>
            {i < STEPS.length - 1 && (
              <div className={`mx-1 h-px w-8 ${step > s.num ? "bg-primary" : "bg-border"}`} />
            )}
          </div>
        ))}
      </div>

      {/* Step 1: Image Upload */}
      {step === 1 && (
        <div>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={`relative flex min-h-[300px] flex-col items-center justify-center rounded-xl border-2 border-dashed transition-colors ${
              dragOver
                ? "border-primary bg-primary/5"
                : imagePreview
                ? "border-border bg-surface"
                : "border-border bg-card hover:border-primary/30"
            }`}
          >
            {imagePreview ? (
              <div className="relative w-full p-4">
                <button
                  onClick={() => { setImageFile(null); setImagePreview(null); setImageDimensions(null); setImageError(""); }}
                  className="absolute right-3 top-3 z-10 rounded-full bg-card p-1.5 shadow hover:bg-card-hover"
                >
                  <X className="h-4 w-4 text-muted" />
                </button>
                <img
                  src={imagePreview}
                  alt="プレビュー"
                  className="mx-auto max-h-[400px] rounded-lg object-contain"
                />
                <p className="mt-3 text-center text-xs text-muted">
                  {imageFile?.name} ({((imageFile?.size ?? 0) / 1024 / 1024).toFixed(1)} MB)
                  {imageDimensions && (
                    <span className="ml-1">— {imageDimensions.w}×{imageDimensions.h}px</span>
                  )}
                </p>
                {imageError && (
                  <div className="mx-auto mt-3 max-w-md rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2">
                    <p className="flex items-start gap-2 text-xs text-red-400">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                      {imageError}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <label className="flex cursor-pointer flex-col items-center gap-3 p-8">
                <Upload className="h-12 w-12 text-muted" />
                <div className="text-center">
                  <p className="text-sm font-medium">
                    O-map画像をドラッグ&ドロップ
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    またはクリックして選択
                  </p>
                </div>
                <p className="text-[10px] text-muted">
                  JPEG / PNG / TIFF — 最大 50MB
                </p>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileSelect(file);
                  }}
                />
              </label>
            )}
          </div>

          <div className="mt-4 rounded-lg border border-border bg-surface p-3">
            <p className="text-xs font-medium text-muted">登録できるO-map</p>
            <ul className="mt-1.5 space-y-1 text-[11px] text-muted">
              <li>- OCAD、Purple Pen等から出力したデジタルファイル（PDF/JPEG/PNG/TIFF）</li>
              <li>- 長辺{MIN_LONG_SIDE}px以上の高解像度データ</li>
            </ul>
            <p className="mt-1.5 text-xs font-medium text-red-400">登録できないもの</p>
            <ul className="mt-1 space-y-1 text-[11px] text-red-400/70">
              <li>- 紙地図をスマートフォンで撮影した写真</li>
              <li>- スクリーンショットや低解像度の画像</li>
            </ul>
          </div>

          <div className="mt-6 flex justify-end">
            <button
              onClick={() => setStep(2)}
              disabled={!imageFile || !!imageError}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-30"
            >
              次へ <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Metadata */}
      {step === 2 && (
        <div>
          <div className="space-y-4">
            {/* Name */}
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">地図名 *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例: 昭和の森"
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>

            {/* Location */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted">都道府県 *</label>
                <select
                  value={prefecture}
                  onChange={(e) => setPrefecture(e.target.value)}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
                >
                  <option value="">選択してください</option>
                  {PREFECTURES.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted">市区町村 *</label>
                <input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="例: 千葉市"
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
                />
              </div>
            </div>

            {/* Terrain */}
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">テレイン *</label>
              <div className="flex flex-wrap gap-2">
                {Object.entries(TERRAIN_LABELS).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setTerrainType(key)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                      terrainType === key
                        ? "border-primary bg-primary/15 text-primary"
                        : "border-border text-muted hover:border-primary/30"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Scale & Contour & Year */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted">縮尺 *</label>
                <select
                  value={scale}
                  onChange={(e) => setScale(e.target.value)}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
                >
                  {SCALES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted">等高線 *</label>
                <select
                  value={contour}
                  onChange={(e) => setContour(Number(e.target.value))}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
                >
                  {CONTOURS.map((c) => (
                    <option key={c} value={c}>{c}m</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted">作成年 *</label>
                <input
                  type="number"
                  value={createdYear}
                  onChange={(e) => setCreatedYear(Number(e.target.value))}
                  min={1970}
                  max={2030}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
                />
              </div>
            </div>

            {/* Description */}
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">説明</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="テレインの特徴、過去の使用大会など..."
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>

            {/* Tags */}
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">タグ</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
                  placeholder="入力してEnter"
                  className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
                />
                <button
                  onClick={addTag}
                  className="rounded-lg border border-border px-3 py-2 text-xs text-muted hover:bg-card-hover"
                >
                  追加
                </button>
              </div>
              {tags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      className="flex items-center gap-1 rounded bg-primary/15 px-2 py-0.5 text-xs text-primary"
                    >
                      {tag}
                      <button onClick={() => setTags(tags.filter((t) => t !== tag))}>
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Visibility */}
            <div>
              <label className="mb-2 block text-xs font-medium text-muted">公開範囲 *</label>
              <div className="space-y-2">
                {VISIBILITY_OPTIONS.map((opt) => (
                  <label
                    key={opt.key}
                    className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                      visibility === opt.key
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/30"
                    }`}
                  >
                    <input
                      type="radio"
                      name="visibility"
                      value={opt.key}
                      checked={visibility === opt.key}
                      onChange={() => setVisibility(opt.key)}
                      className="mt-0.5 accent-primary"
                    />
                    <div>
                      <div className="text-sm font-medium">{opt.label}</div>
                      <div className="text-xs text-muted">{opt.desc}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-6 flex justify-between">
            <button
              onClick={() => setStep(1)}
              className="flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm text-muted hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" /> 戻る
            </button>
            <button
              onClick={() => setStep(3)}
              disabled={!step2Valid}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-30"
            >
              次へ <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Georeferencing */}
      {step === 3 && (
        <div>
          <div className="rounded-xl border border-border bg-card p-4">
            <h3 className="text-sm font-semibold">位置合わせ（ジオリファレンス）</h3>
            <p className="mt-1 text-xs text-muted">
              地図画像を国土地理院の地図上にドラッグして位置を合わせてください。
            </p>

            {skipGeoref ? (
              <div className="mt-4 rounded-lg border border-border bg-surface p-8 text-center text-sm text-muted">
                位置合わせをスキップします。後から管理画面で設定できます。
              </div>
            ) : (
              <div className="mt-4 rounded-lg border border-border bg-surface">
                {/* Placeholder for georeferencing map - will be implemented with MapLibre */}
                <div className="flex h-[350px] items-center justify-center text-muted">
                  <div className="text-center">
                    <MapPin className="mx-auto h-10 w-10 text-muted/50" />
                    <p className="mt-3 text-sm">位置合わせビューア</p>
                    <p className="mt-1 text-xs text-muted">
                      地図画像をベースマップ上にドラッグ&ドロップで配置
                    </p>
                    <p className="mt-1 text-[10px] text-muted">
                      （Phase 2で実装予定。現在はスキップを推奨）
                    </p>
                  </div>
                </div>
              </div>
            )}

            <label className="mt-3 flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={skipGeoref}
                onChange={(e) => setSkipGeoref(e.target.checked)}
                className="accent-primary"
              />
              <span className="text-muted">位置合わせをスキップ（後から設定可能）</span>
            </label>
          </div>

          {/* Summary */}
          <div className="mt-6 rounded-xl border border-border bg-card p-4">
            <h3 className="text-sm font-semibold">登録内容の確認</h3>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div className="text-muted">地図名</div>
              <div>{name}</div>
              <div className="text-muted">場所</div>
              <div>{prefecture} {city}</div>
              <div className="text-muted">テレイン</div>
              <div>{TERRAIN_LABELS[terrainType] ?? "-"}</div>
              <div className="text-muted">縮尺 / 等高線</div>
              <div>{scale} / {contour}m</div>
              <div className="text-muted">作成年</div>
              <div>{createdYear}年</div>
              <div className="text-muted">公開範囲</div>
              <div>{VISIBILITY_OPTIONS.find((v) => v.key === visibility)?.label}</div>
              <div className="text-muted">画像</div>
              <div>{imageFile?.name ?? "未選択"}</div>
              <div className="text-muted">登録者</div>
              <div>{getCurrentUser()?.displayName ?? "-"}</div>
            </div>
          </div>

          <div className="mt-6 flex justify-between">
            <button
              onClick={() => setStep(2)}
              className="flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm text-muted hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" /> 戻る
            </button>
            <button
              onClick={handleSubmit}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-dark"
            >
              <Check className="h-4 w-4" /> 登録する
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
