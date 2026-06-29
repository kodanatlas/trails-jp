import { Loader2 } from "lucide-react";

// レッグ分析ページのサーバ解決(大会名/日付)中に即表示。遷移直後の空白を防ぐ。
export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <div className="flex flex-col items-center justify-center gap-3 text-muted">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <p className="text-sm">レッグ分析を読み込んでいます…</p>
      </div>
    </div>
  );
}
