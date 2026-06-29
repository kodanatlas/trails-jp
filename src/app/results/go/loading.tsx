import { Loader2 } from "lucide-react";

// 解決ルート実行中(events/クラス取得→redirect)に即座に表示し、クリックの無反応感を消す。
export default function Loading() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-muted">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
      <p className="text-sm">レッグ分析を開いています…</p>
    </div>
  );
}
