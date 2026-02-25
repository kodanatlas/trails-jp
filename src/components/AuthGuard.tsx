"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { LogIn, ShieldCheck, Mail } from "lucide-react";

/**
 * 認証ガード: 未認証ユーザーにログインを促す
 * Supabase Auth 導入後は実際のセッションチェックに置き換え
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    // TODO: Supabase Auth 導入後に実装
    // const { data: { session } } = await supabase.auth.getSession();
    // setIsAuthenticated(!!session);

    // 現在は開発用: localStorage にトークンがあれば認証済みとみなす
    const devToken = localStorage.getItem("trails_dev_auth");
    setIsAuthenticated(!!devToken);
  }, []);

  // ローディング中
  if (isAuthenticated === null) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  // 未認証
  if (!isAuthenticated) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
          <ShieldCheck className="h-8 w-8 text-primary" />
        </div>
        <h2 className="text-xl font-bold">ログインが必要です</h2>
        <p className="mt-3 text-sm text-muted">
          地図のアップロードにはメール認証済みのアカウントが必要です。
        </p>

        <div className="mt-8 space-y-3">
          <button
            onClick={() => {
              // TODO: Supabase Auth のメール認証フロー
              // await supabase.auth.signInWithOtp({ email })
              alert("Supabase Auth 実装後にメール認証が利用可能になります。\n\n開発用: localStorage に trails_dev_auth=1 を設定するとバイパスできます。");
            }}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-primary-dark"
          >
            <Mail className="h-4 w-4" />
            メールアドレスでログイン
          </button>

          <Link
            href="/"
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-card px-6 py-3 text-sm font-medium text-foreground transition-colors hover:bg-card-hover"
          >
            トップに戻る
          </Link>
        </div>

        <div className="mt-8 rounded-lg border border-border bg-surface p-4 text-left">
          <h3 className="flex items-center gap-2 text-xs font-semibold text-muted">
            <LogIn className="h-3.5 w-3.5" />
            アカウントについて
          </h3>
          <ul className="mt-2 space-y-1.5 text-xs text-muted">
            <li>- メールアドレスで簡単に登録できます</li>
            <li>- パスワード不要（マジックリンク認証）</li>
            <li>- メール認証完了後、地図のアップロードが可能になります</li>
            <li>- アップロードした地図は管理画面から管理できます</li>
          </ul>
        </div>
      </div>
    );
  }

  // 認証済み
  return <>{children}</>;
}
