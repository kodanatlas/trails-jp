import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";
import { Analytics } from "@vercel/analytics/next";
import { SITE_URL } from "@/lib/site";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
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
    <html lang="ja">
      <body
        className={`${geistSans.variable} ${geistMono.variable} flex min-h-screen flex-col font-sans antialiased`}
      >
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
