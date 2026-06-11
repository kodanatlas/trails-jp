/**
 * /admin/cron-status のローディングUI。
 * cron_log のライブ取得を待たずに即座に遷移させるための Suspense フォールバック。
 */
export default function CronStatusLoading() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <h1 className="mb-6 text-2xl font-bold">Cron 稼働状況</h1>
      <div className="animate-pulse space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="overflow-hidden rounded-lg border border-border bg-card p-4"
          >
            <div className="mb-3 h-5 w-1/3 rounded bg-white/5" />
            <div className="flex gap-3">
              <div className="h-3.5 w-24 rounded bg-white/5" />
              <div className="h-3.5 w-32 rounded bg-white/5" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
