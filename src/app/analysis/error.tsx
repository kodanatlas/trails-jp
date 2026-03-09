"use client";

import { useEffect } from "react";

export default function AnalysisError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Analysis error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <h2 className="mb-4 text-2xl font-bold text-white">
        分析データの読み込みに失敗しました
      </h2>
      <p className="mb-6 text-gray-400">
        データの取得中にエラーが発生しました。しばらくしてからもう一度お試しください。
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
