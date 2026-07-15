import type { Metadata } from "next";
import Link from "next/link";
import { readOringen } from "@/lib/oringen-store";

/**
 * 海外遠征 — 大会一覧。**期間限定**。
 *
 * いまは O-Ringen 2026 の1件のみ。大会が増えたらここに足す（器だけ先に用意している）。
 * 撤去手順は docs/plans/2026-07-15_abroad_oringen.md の「掲載終了」節。
 */

export const metadata: Metadata = {
  title: "海外遠征",
  description: "日本勢が出場する海外大会の情報（trails.jp）。",
  // 実名・所属が並ぶ期間限定ページ。検索エンジンには載せない。
  robots: { index: false, follow: false },
};

export const revalidate = 600;

/** 大会の開催状況。JST 基準で判定する（読み手が日本にいるため）。 */
function statusOf(from: string, to: string): { label: string; live: boolean } | null {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date());
  if (today < from) return null;
  if (today > to) return { label: "終了", live: false };
  return { label: "開催中", live: true };
}

export default async function AbroadIndex() {
  const oringen = await readOringen();
  const from = oringen.races[0]?.date ?? "";
  const to = oringen.races[oringen.races.length - 1]?.date ?? "";
  const clubs = new Set(oringen.people.map((p) => p.club)).size;
  const status = statusOf(from, to);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="mb-1 text-2xl font-bold">海外遠征</h1>
      <p className="mb-5 text-xs text-muted">
        日本勢が出場する海外大会のスタートリストと日程。大会ごとに現地の公式データから取得しています。
      </p>

      <Link
        href="/abroad/oringen-2026"
        className="block rounded-md border border-border bg-card p-4 transition-colors hover:bg-card-hover"
      >
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span className="text-base font-bold text-foreground">{oringen.eventName} 2026</span>
          {status && (
            <span
              className={
                status.live
                  ? "rounded bg-accent/20 px-2 py-0.5 text-[10px] font-medium text-[#00e5ff]"
                  : "rounded bg-card-hover px-2 py-0.5 text-[10px] font-medium text-muted"
              }
            >
              {status.label}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-muted">
          <span>
            {from} 〜 {to}
          </span>
          <span>スウェーデン / イェーテボリ</span>
          <span>日本勢 {oringen.people.length} 名</span>
          <span>{clubs} クラブ</span>
        </div>
      </Link>
    </div>
  );
}
