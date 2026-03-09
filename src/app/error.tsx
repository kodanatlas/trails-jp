"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Unhandled error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <h2 className="mb-4 text-2xl font-bold text-white">
        エラーが発生しました
      </h2>
      <p className="mb-6 text-gray-400">
        予期しないエラーが発生しました。問題が解決しない場合はお問い合わせください。
      </p>
      <button
        onClick={reset}
        className="rounded-lg bg-blue-600 px-6 py-3 text-white transition hover:bg-blue-700"
      >
        もう一度試す
      </button>
    </div>
  );
}
