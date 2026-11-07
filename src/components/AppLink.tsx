import Link from "next/link";
import type { ComponentProps } from "react";

/**
 * 先読み（prefetch）を既定で切った next/link。
 *
 * Next.js の Link は画面に入ったリンク先を自動で取りに行くため、ヘッダー・フッター・
 * 選手一覧のリンクだけで 1 ページ表示あたり 10 件前後の CDN リクエストが増え、
 * Vercel Hobby の CDN リクエスト上限（30 日で 100 万）に迫った（2026-11-08）。
 * 押した時点で取りに行けば十分なので、必要な箇所だけ prefetch を明示して上書きする。
 */
export default function AppLink({ prefetch = false, ...props }: ComponentProps<typeof Link>) {
  return <Link prefetch={prefetch} {...props} />;
}
