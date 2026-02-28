import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ContactForm } from "./ContactForm";

export const metadata: Metadata = {
  title: "お問い合わせ | trails.jp",
  description: "trails.jp へのお問い合わせ・ご要望はこちらから。",
};

export default function ContactPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <Link href="/" className="mb-6 inline-flex items-center gap-1 text-xs text-muted hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" />
        トップに戻る
      </Link>

      <h1 className="text-2xl font-bold">お問い合わせ</h1>
      <p className="mt-2 text-sm text-muted">
        ご質問・ご要望・不具合報告など、お気軽にお送りください。
      </p>

      <div className="mt-8">
        <ContactForm />
      </div>

      <div className="mt-8 rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
        <p className="text-xs text-amber-400">
          大会に関する個別のお問い合わせは、各大会の主催者または
          <a href="https://orienteering.com/" target="_blank" rel="noopener noreferrer" className="underline hover:text-amber-300">JOY</a>
          へ直接ご連絡ください。
        </p>
      </div>
    </div>
  );
}
