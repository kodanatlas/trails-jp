import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_JP, IBM_Plex_Mono } from "next/font/google";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";
import { Analytics } from "@vercel/analytics/next";
import { SITE_URL } from "@/lib/site";
import "./globals.css";

// 本文・UI・選手名など動的な日本語を担う唯一の和文ファミリ。
// 動的な漢字はサブセット不可のため preload:false + display:swap + 強い
// システムフォールバックで「初回はネイティブ和ゴシック→Plex が無段差で差し替わる」運用。
// （CJK は size-adjust 自動補正が効かず軽微な FOUT/CLS は許容トレード）
const plexJp = IBM_Plex_Sans_JP({
  weight: ["400", "500", "700"],
  subsets: ["latin"], // 'japanese' はサブセットキーに無い。和文グリフは unicode-range で遅延取得
  display: "swap",
  preload: false,
  variable: "--font-plex-jp",
  fallback: [
    "Hiragino Kaku Gothic ProN",
    "Hiragino Sans",
    "Yu Gothic",
    "Meiryo",
    "sans-serif",
  ],
});

// 数値（順位・ポイント・タイム・速度）専用。和文の IBM Plex Sans JP と同ファミリで
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
  icons: {
    apple: "/icons/apple-touch-icon.svg",
  },
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
        className={`${plexJp.variable} ${plexMono.variable} flex min-h-screen flex-col font-sans antialiased`}
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
