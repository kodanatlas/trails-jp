import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-white/10 bg-[#1a2332]">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-4 py-6 text-xs text-white/40 sm:flex-row sm:justify-between">
        <p>&copy; 2026 trails.jp</p>
        <div className="flex gap-6">
          <Link href="/about" className="transition-colors hover:text-white/70">
            このサイトについて
          </Link>
          <Link href="/contact" className="transition-colors hover:text-white/70">
            お問い合わせ
          </Link>
        </div>
      </div>
    </footer>
  );
}
