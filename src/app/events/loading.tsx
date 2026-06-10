/**
 * /events のローディングUI。
 * force-dynamic なデータ取得を待たずに即座に遷移させるための Suspense フォールバック。
 */
export default function EventsLoading() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-1 flex items-center gap-2">
        <h1 className="text-2xl font-bold">イベント</h1>
        <span className="rounded bg-accent/20 px-2 py-0.5 text-[10px] font-medium text-[#00e5ff]">
          JOY 連携
        </span>
      </div>
      <p className="mb-6 text-xs text-muted">読み込み中…</p>

      <div className="animate-pulse">
        {/* フィルタバーのスケルトン */}
        <div className="mb-4 flex flex-wrap gap-2">
          <div className="h-9 w-48 rounded-lg border border-border bg-surface" />
          <div className="h-9 w-32 rounded-lg border border-border bg-surface" />
          <div className="h-9 w-32 rounded-lg border border-border bg-surface" />
        </div>

        {/* イベントカードのスケルトン */}
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="overflow-hidden rounded-lg border border-border bg-card p-4"
            >
              <div className="mb-3 h-5 w-2/3 rounded bg-white/5" />
              <div className="flex gap-3">
                <div className="h-3.5 w-24 rounded bg-white/5" />
                <div className="h-3.5 w-32 rounded bg-white/5" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
