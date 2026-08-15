"use client";

import Link from "next/link";
import { Wordmark } from "@/components/site/Wordmark";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { markDashboardAuthenticated } from "@/lib/dashboard/client";
import { dashboardErrorMessage } from "@/lib/dashboard/errors";
import { track } from "@/lib/analytics";
import { loginAction } from "./actions";
import { buttonClass } from "@/components/ui/Button";

// useSearchParams must sit under a Suspense boundary. It surfaces the fixed
// error code the no-JS Server Action redirect leaves in ?error= (see actions.ts).
export default function DashboardLoginPage() {
  return (
    <Suspense fallback={<LoginForm redirectError={null} />}>
      <LoginFormWithParams />
    </Suspense>
  );
}

function LoginFormWithParams() {
  // 2026-08-06 (UX audit item 7): the no-JS login fallback redirects back here
  // with ?error=<code> on failure. Reading it via useSearchParams (not a
  // setState-in-effect) keeps render pure and avoids a hydration mismatch.
  const redirectError = useSearchParams().get("error");
  return <LoginForm redirectError={redirectError} />;
}

function LoginForm({ redirectError }: { redirectError: string | null }) {
  const router = useRouter();
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // The live (JS-path) error wins; otherwise fall back to the redirect code.
  const shownError = error ?? redirectError;

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/dashboard/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error ?? "invalid_api_key");
        return;
      }

      markDashboardAuthenticated();
      // 2026-08-06 growth: login_completed = returning-user retention signal,
      // distinct from signup_completed (first key issuance). No props: the
      // API key must never appear in analytics.
      track("login_completed");
      router.push("/dashboard");
    } catch {
      setError("connection_failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    // 2026-08-13 全盲ペルソナ監査 R2: この頁は SiteChrome の #main-content も
    // DashboardShell の <main id="dashboard-main"> も通らない（どちらも
    // /dashboard/login では children をそのまま返す早期 return を持つ）。結果、
    // 公開8頁と違いこの頁だけ <main> ランドマークが不在で、axe が
    // landmark-one-main（<main> 無し）と region（フォームの中身がどのランドマーク
    // にも属さない）の2件を出していた。頁の骨組みはこの要素なので、外枠を
    // <main> にするだけで両方が解ける（レイアウト・見た目は不変）。
    <main className="flex min-h-screen items-center justify-center bg-ground px-6">
      {/* 2026-08-06 (UX audit item 7): `action` is the Server Action fallback
          and `onSubmit` (which preventDefaults) is the JS path. With JS on, our
          handler runs and the action is skipped; with JS off, the browser POSTs
          natively to the action — the key rides in the request BODY (React sets
          method=post for function actions), never a URL. */}
      <form
        action={loginAction}
        onSubmit={onSubmit}
        className="sheet w-full max-w-md space-y-4"
      >
        <div>
          {/* 2026-08-12 FIX-8: このページは <nav> も <footer> も無く、リンクは
              /signup の1本だけ。「Vouch」も非リンクだったので、キーを持たない
              訪問者はブラウザバック以外にサイトへ戻る手段が無かった。 */}
          <Link href="/" className="inline-block">
            <Wordmark className="text-[1.0625rem] leading-none" />
          </Link>
          <h1 className="dash-title mt-1">Dashboard sign in</h1>
          <p className="mt-2 text-sm text-brand">
            Your API key is exchanged for a secure httpOnly session cookie. It is never stored in
            the browser.
          </p>
        </div>

        {/* 2026-08-12: 枠線を zinc-300 → zinc-500 にした（下の signup と同じ是正）。
            ここだけ持っていた `outline-none focus:border-zinc-500` も外した。地色が
            zinc-500 になった時点で focus 時の枠色変化は差分ゼロの死んだ指定になり、
            フォーカス表示は globals.css の :focus-visible（シアン 2px・白地 3.68:1）が
            実際に描画している側なので、他の入力欄と同じ挙動へ揃う。実測で確認済み
            （Tab 移動時 outline: solid 2px rgb(8,145,178)）。 */}
        <label className="block space-y-1 text-sm">
          <span className="doc-caption">API key</span>
          <input
            type="password"
            name="apiKey"
            autoComplete="current-password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="vouch_live_..."
            className="w-full rounded-[2px] border border-brand-lift bg-paper px-3 py-2 font-mono text-sm text-brand-deep placeholder:text-brand-lift"
            required
          />
        </label>

        {shownError && (
          <p className="rounded-[2px] border border-block-ink bg-paper px-3 py-2 text-sm text-block-ink">
            {dashboardErrorMessage(shownError)}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className={buttonClass({ className: "w-full" })}
        >
          {loading ? "Signing in..." : "Continue"}
        </button>

        <p className="text-center text-sm text-brand">
          No account?{" "}
          <a href="/signup" className="doc-link font-medium">
            Sign up free
          </a>
        </p>
      </form>
    </main>
  );
}
