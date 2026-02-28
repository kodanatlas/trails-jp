"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { LogIn, ShieldCheck, Mail, ArrowLeft, Loader2, User } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { User as SupabaseUser } from "@supabase/supabase-js";

interface AuthUser {
  email: string;
  displayName: string;
}

function extractAuthUser(u: SupabaseUser): AuthUser {
  return {
    email: u.email!,
    displayName: u.user_metadata?.display_name ?? u.email!,
  };
}

/**
 * 認証ガード: Supabase Auth (Email OTP) で認証
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null | "loading">("loading");
  const [step, setStep] = useState<"form" | "confirm">("form");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [sending, setSending] = useState(false);
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    // 既存セッション確認
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser(extractAuthUser(session.user));
      } else {
        setUser(null);
      }
    });

    // 認証状態の変更を監視
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUser(extractAuthUser(session.user));
      } else {
        setUser(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleSendCode = async () => {
    if (!email || !email.includes("@")) {
      setError("有効なメールアドレスを入力してください");
      return;
    }
    if (!displayName.trim()) {
      setError("ユーザー名を入力してください");
      return;
    }
    setError("");
    setSending(true);

    const siteUrl =
      typeof window !== "undefined"
        ? window.location.origin
        : "https://trailsjp.vercel.app";

    const { error: otpError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        data: { display_name: displayName.trim() },
        emailRedirectTo: `${siteUrl}/upload`,
      },
    });

    setSending(false);

    if (otpError) {
      setError(otpError.message);
      return;
    }

    setStep("confirm");
  };

  const handleVerify = async () => {
    if (!code || code.length < 8) {
      setError("8桁の確認コードを入力してください");
      return;
    }
    setError("");
    setVerifying(true);

    const { data, error: verifyError } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: "email",
    });

    setVerifying(false);

    if (verifyError) {
      setError(verifyError.message);
      return;
    }

    if (data.user) {
      setUser(extractAuthUser(data.user));
    }
  };

  // ローディング中
  if (user === "loading") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  // 認証済み
  if (user) {
    return <>{children}</>;
  }

  // 未登録: メールアドレス＋ユーザー名入力
  if (step === "form") {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
          <ShieldCheck className="h-8 w-8 text-primary" />
        </div>
        <h2 className="text-xl font-bold">アカウント登録</h2>
        <p className="mt-3 text-sm text-muted">
          O-mapの登録にはユーザー登録が必要です。メールアドレスとユーザー名を入力してください
        </p>

        <div className="mt-8 space-y-4">
          <div className="text-left">
            <label className="mb-1.5 block text-xs font-medium text-muted">メールアドレス</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(""); }}
                placeholder="you@example.com"
                className="w-full rounded-lg border border-border bg-surface py-3 pl-10 pr-4 text-sm outline-none focus:border-primary"
                autoFocus
              />
            </div>
          </div>

          <div className="text-left">
            <label className="mb-1.5 block text-xs font-medium text-muted">ユーザー名（公開表示名）</label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input
                type="text"
                value={displayName}
                onChange={(e) => { setDisplayName(e.target.value); setError(""); }}
                onKeyDown={(e) => { if (e.key === "Enter") handleSendCode(); }}
                placeholder="例: 山田太郎"
                className="w-full rounded-lg border border-border bg-surface py-3 pl-10 pr-4 text-sm outline-none focus:border-primary"
              />
            </div>
            <p className="mt-1 text-[10px] text-muted">登録したO-mapに表示されます</p>
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <button
            onClick={handleSendCode}
            disabled={sending || !email || !displayName.trim()}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-50"
          >
            {sending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                送信中...
              </>
            ) : (
              "確認コードを送信"
            )}
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
            ユーザー登録について
          </h3>
          <ul className="mt-2 space-y-1.5 text-xs text-muted">
            <li>- パスワード不要（確認コード認証）</li>
            <li>- 登録したO-mapにユーザー名が表示されます</li>
            <li>- 登録後すぐにO-mapの追加が可能です</li>
          </ul>
        </div>
      </div>
    );
  }

  // 確認コード入力
  return (
    <div className="mx-auto max-w-lg px-4 py-16 text-center">
      <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-green-500/10">
        <Mail className="h-8 w-8 text-green-400" />
      </div>
      <h2 className="text-xl font-bold">確認コードを入力</h2>
      <p className="mt-3 text-sm text-muted">
        <span className="font-medium text-foreground">{email}</span> に8桁の確認コードを送信しました
      </p>

      <div className="mt-8 space-y-4">
        <div className="text-left">
          <label className="mb-1.5 block text-xs font-medium text-muted">確認コード</label>
          <input
            type="text"
            inputMode="numeric"
            value={code}
            onChange={(e) => { setCode(e.target.value.replace(/\D/g, "").slice(0, 8)); setError(""); }}
            onKeyDown={(e) => { if (e.key === "Enter") handleVerify(); }}
            placeholder="00000000"
            maxLength={8}
            className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-center font-mono text-2xl tracking-[0.3em] outline-none focus:border-primary"
            autoFocus
          />
          {error && <p className="mt-1.5 text-xs text-red-400">{error}</p>}
        </div>

        <button
          onClick={handleVerify}
          disabled={verifying || code.length < 8}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-50"
        >
          {verifying ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              確認中...
            </>
          ) : (
            "登録する"
          )}
        </button>

        <div className="flex items-center justify-between text-xs text-muted">
          <button
            onClick={() => { setStep("form"); setCode(""); setError(""); }}
            className="flex items-center gap-1 hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" />
            入力に戻る
          </button>
          <button
            onClick={handleSendCode}
            disabled={sending}
            className="hover:text-foreground disabled:opacity-50"
          >
            {sending ? "送信中..." : "コードを再送信"}
          </button>
        </div>
      </div>

      <p className="mt-6 text-xs text-muted">
        メールが届かない場合は迷惑メールフォルダをご確認ください
      </p>
    </div>
  );
}

/** 現在のログインユーザーを取得（同期的に呼び出し可能） */
export function getCurrentUser(): AuthUser | null {
  if (typeof window === "undefined") return null;

  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!url) return null;
    const projectRef = new URL(url).hostname.split(".")[0];
    const key = `sb-${projectRef}-auth-token`;
    const raw = localStorage.getItem(key);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    const u = parsed?.user;
    if (!u?.email) return null;

    return {
      email: u.email,
      displayName: u.user_metadata?.display_name ?? u.email,
    };
  } catch {
    return null;
  }
}
