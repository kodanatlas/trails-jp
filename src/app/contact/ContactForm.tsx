"use client";

import { useState } from "react";
import { Send, Loader2, CheckCircle } from "lucide-react";

const FORMSPREE_ID = process.env.NEXT_PUBLIC_FORMSPREE_ID ?? "";

export function ContactForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [category, setCategory] = useState("general");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) {
      setError("メッセージを入力してください");
      return;
    }
    if (!FORMSPREE_ID) {
      setError("フォームが設定されていません");
      return;
    }

    setError("");
    setSending(true);

    try {
      const res = await fetch(`https://formspree.io/f/${FORMSPREE_ID}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          name: name || "匿名",
          email: email || "未入力",
          category,
          message,
        }),
      });

      if (res.ok) {
        setSent(true);
      } else {
        setError("送信に失敗しました。しばらく経ってから再度お試しください。");
      }
    } catch {
      setError("送信に失敗しました。ネットワーク接続をご確認ください。");
    } finally {
      setSending(false);
    }
  };

  if (sent) {
    return (
      <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-8 text-center">
        <CheckCircle className="mx-auto mb-3 h-10 w-10 text-green-400" />
        <h2 className="text-lg font-semibold text-foreground">送信完了</h2>
        <p className="mt-2 text-sm text-muted">
          お問い合わせありがとうございます。内容を確認の上、必要に応じてご返信いたします。
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted">
          お名前 <span className="text-muted/50">（任意）</span>
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="山田 太郎"
          className="w-full rounded-lg border border-border bg-surface px-4 py-2.5 text-sm outline-none focus:border-primary"
        />
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted">
          メールアドレス <span className="text-muted/50">（返信が必要な場合）</span>
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="w-full rounded-lg border border-border bg-surface px-4 py-2.5 text-sm outline-none focus:border-primary"
        />
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted">カテゴリ</label>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="w-full rounded-lg border border-border bg-surface px-4 py-2.5 text-sm outline-none focus:border-primary"
        >
          <option value="general">一般的な質問</option>
          <option value="bug">不具合の報告</option>
          <option value="feature">機能リクエスト</option>
          <option value="data">データの誤り</option>
          <option value="other">その他</option>
        </select>
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted">
          メッセージ <span className="text-red-400">*</span>
        </label>
        <textarea
          value={message}
          onChange={(e) => { setMessage(e.target.value); setError(""); }}
          placeholder="お問い合わせ内容をご記入ください..."
          rows={5}
          className="w-full resize-none rounded-lg border border-border bg-surface px-4 py-2.5 text-sm outline-none focus:border-primary"
        />
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={sending || !message.trim()}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-50"
      >
        {sending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            送信中...
          </>
        ) : (
          <>
            <Send className="h-4 w-4" />
            送信する
          </>
        )}
      </button>
    </form>
  );
}
