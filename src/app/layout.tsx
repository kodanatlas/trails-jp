import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";
import { Analytics } from "@vercel/analytics/next";
import { SITE_URL } from "@/lib/site";
import "./globals.css";

// 英数字 = IBM Plex Sans（latin サブセットのみ・太さごとに 1 ファイル）、和文 = 端末のゴシック。
// 2026-11-08 まで和文も IBM Plex Sans JP を配信していたが、漢字の多いページでは unicode-range の
// 分割ファイルを 1 表示で 150 件前後取りに行き、Vercel Hobby の CDN リクエスト上限（30 日 100 万）を
// 圧迫したため端末フォントに切り替えた。Plex Sans JP の英字は Plex Sans と同じデザインなので英数字の見た目は不変。
// Windows の游ゴシックは細くかすれやすいのでメイリオを先に置く。
const plexSans = IBM_Plex_Sans({
  weight: ["400", "500", "700"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-plex-sans",
  fallback: [
    "Hiragino Sans",
    "Hiragino Kaku Gothic ProN",
    "Meiryo",
    "Yu Gothic",
    "sans-serif",
  ],
});

// 数値（順位・ポイント・タイム・速度）専用。英数字の IBM Plex Sans と同ファミリで
// 一体感を出しつつ、Geist Mono より字幅がありデータが読みやすい。tabular-nums で桁揃え。
const plexMono = IBM_Plex_Mono({
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "trails.jp - 日本オリエンテーリング統合プラットフォーム",
    template: "%s | trails.jp",
  },
  description:
    "日本のオリエンテーリング・トレイルランのためのイベント情報、ランキング、選手分析を集約したプラットフォーム。",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "trails.jp",
  },
  // favicon / apple-touch-icon はファイル規約（src/app/icon.png, apple-icon.png）で自動生成。
  // iOS は SVG の apple-touch-icon を解釈できないため必ず PNG を維持すること。
};

export const viewport: Viewport = {
  themeColor: "#f97316",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <body
        className={`${plexSans.variable} ${plexMono.variable} flex min-h-screen flex-col font-sans antialiased`}
      >
        {/* テーマ初期化（描画前に data-theme を設定しフラッシュを防止）。既定=ダーク、保存値が light の時のみ反転。 */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('theme');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();",
          }}
        />
        <ServiceWorkerRegistration />
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
        {/* Vercel Web Analytics: ページ別アクセス数を計測（Cookie不使用）。
            データ収集には Vercel ダッシュボードで Web Analytics を有効化する必要がある。 */}
        <Analytics />
      </body>
    </html>
  );
}
