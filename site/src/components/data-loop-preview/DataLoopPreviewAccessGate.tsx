"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

type Props = {
  configured: boolean;
};

function responseMessage(value: unknown, fallback: string): string {
  if (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "object" &&
    value.error !== null &&
    "message" in value.error &&
    typeof value.error.message === "string"
  ) {
    return value.error.message;
  }
  return fallback;
}

export default function DataLoopPreviewAccessGate({ configured }: Props) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!configured) {
    return (
      <section className="theme-alert px-5 py-5 text-[#78451F]" role="alert">
        <h2 className="text-lg font-bold">限定公開の設定が完了していません</h2>
        <p className="mt-2 text-sm leading-relaxed">
          管理者が実証環境のアクセス設定を完了するまで、この画面は利用できません。
        </p>
      </section>
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/research/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) {
        setError(responseMessage(payload, "ログインできませんでした。少し待って再度お試しください。"));
        return;
      }
      setPassword("");
      router.refresh();
    } catch {
      setError("通信に失敗しました。接続を確認して再度お試しください。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="theme-panel mx-auto max-w-xl px-5 py-6 sm:px-7" aria-labelledby="data-loop-login-title">
      <h2 id="data-loop-login-title" className="theme-section-title text-xl sm:text-2xl">
        パスワード付きテスト画面
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-[#4A5568]">
        予算Data Loopは検証中です。共有された実証環境用パスワードを入力してください。
      </p>
      <form className="mt-5" onSubmit={handleSubmit}>
        <label htmlFor="data-loop-access-password" className="block font-bold text-[#1B3A6B]">
          パスワード
        </label>
        <input
          id="data-loop-access-password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={256}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="theme-input mt-2 px-4 py-3 text-base"
        />
        {error ? (
          <div className="theme-alert mt-4 px-4 py-3 text-sm text-[#78451F]" role="alert">
            {error}
          </div>
        ) : null}
        <button
          type="submit"
          disabled={submitting || !password}
          className="theme-button theme-button-accent mt-5 min-h-12 w-full px-6 py-3 text-base disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          {submitting ? "確認しています…" : "限定プレビューを見る"}
        </button>
      </form>
    </section>
  );
}

export function DataLoopPreviewLogoutButton() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  async function logout() {
    setSubmitting(true);
    try {
      await fetch("/api/research/session", { method: "DELETE", cache: "no-store" });
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <button
      type="button"
      onClick={logout}
      disabled={submitting}
      className="theme-button border border-[#CBD5E0] bg-white px-4 py-2 text-sm font-bold text-[#1B3A6B] hover:border-[#1B3A6B] hover:bg-[#E8EEF7] disabled:cursor-not-allowed disabled:opacity-60"
    >
      {submitting ? "ログアウト中…" : "ログアウト"}
    </button>
  );
}
