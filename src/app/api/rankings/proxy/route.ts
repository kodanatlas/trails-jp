import { NextResponse } from "next/server";

// JOYランキングページをプロキシして返す（ビルド時に使用）
// Vercelビルド環境からJOY直接curlが失敗するため、
// Serverless Function経由でフェッチする

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const typeId = url.searchParams.get("typeId");
  const classId = url.searchParams.get("classId");
  const page = url.searchParams.get("page") || "0";

  if (!typeId || !classId) {
    return NextResponse.json({ error: "typeId and classId required" }, { status: 400 });
  }

  const joyUrl = page === "0"
    ? `https://japan-o-entry.com/ranking/ranking/ranking_index/${typeId}/${classId}`
    : `https://japan-o-entry.com/ranking/ranking/ranking_index/${typeId}/${classId}/${page}`;

  const res = await fetch(joyUrl, {
    headers: { "User-Agent": "trails.jp/1.0 (build sync)" },
  });

  // 上流(JOY)のステータスを伝搬する。エラーページを正常HTMLとして
  // ビルド側に渡すと既存ランキングを破壊しうるため、502として返す。
  if (!res.ok) {
    return new Response(`Upstream ${res.status}`, { status: 502 });
  }

  return new Response(await res.text(), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
