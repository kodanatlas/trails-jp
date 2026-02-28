import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Map, CalendarDays, BarChart3, Radio, Database } from "lucide-react";

export const metadata: Metadata = {
  title: "このサイトについて | trails.jp",
  description: "trails.jp は日本のオリエンテーリング情報を集約するプラットフォームです。",
};

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <Link href="/" className="mb-6 inline-flex items-center gap-1 text-xs text-muted hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" />
        トップに戻る
      </Link>

      <h1 className="text-2xl font-bold">このサイトについて</h1>

      <div className="mt-6 space-y-6 text-sm leading-relaxed text-muted">
        <p>
          <strong className="text-foreground">trails.jp</strong> は、日本のオリエンテーリング情報を一つに集約するプラットフォームです。
          大会情報、テレイン（O-map）データベース、GPS追跡、ランキングなど、オリエンテーリングに関わる情報へのアクセスを提供します。
        </p>

        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-foreground">主な機能</h2>

          <div className="grid gap-3 sm:grid-cols-2">
            {[
              {
                icon: CalendarDays,
                title: "イベント",
                desc: "JOY（日本オリエンテーリング協会）から大会情報を日次で自動取得。エントリー状況や開催地を一覧・カレンダーで確認できます。",
              },
              {
                icon: Database,
                title: "地図データベース",
                desc: "全国のオリエンテーリング用地図（O-map）を地図上で検索・閲覧。ユーザー登録すれば誰でもO-mapを追加できます。",
              },
              {
                icon: Radio,
                title: "GPS追跡",
                desc: "大会でのGPSトラッキングデータを地図上で可視化。選手の動きをリアルタイムで確認できます。",
              },
              {
                icon: BarChart3,
                title: "ランキング",
                desc: "Lap Center と連携し、クラス別のランキングを表示。選手の成績を横断的に確認できます。",
              },
            ].map((item) => (
              <div key={item.title} className="rounded-lg border border-border bg-card p-4">
                <div className="mb-2 flex items-center gap-2">
                  <item.icon className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-semibold text-foreground">{item.title}</h3>
                </div>
                <p className="text-xs leading-relaxed text-muted">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">データソース</h2>
          <ul className="list-inside list-disc space-y-1 text-xs">
            <li>大会情報: <a href="https://orienteering.com/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">JOY (Japan O-entry)</a></li>
            <li>成績データ: <a href="https://mulka2.com/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Lap Center</a></li>
            <li>地図タイル: 国土地理院 / OpenStreetMap</li>
          </ul>
        </div>

        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">免責事項</h2>
          <p className="text-xs">
            本サイトの情報は正確性を保つよう努めていますが、外部データソースの更新状況により最新でない場合があります。
            大会へのエントリーや詳細確認は、必ず公式サイトをご参照ください。
          </p>
        </div>
      </div>
    </div>
  );
}
