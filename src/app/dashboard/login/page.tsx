"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { markDashboardAuthenticated } from "@/lib/dashboard/client";
import { dashboardErrorMessage } from "@/lib/dashboard/errors";
import { track } from "@/lib/analytics";

export default function DashboardLoginPage() {
  const router = useRouter();
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-6">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md space-y-4 rounded-xl border border-zinc-200 bg-white p-8 shadow-sm"
      >
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Vouch</p>
          <h1 className="mt-1 text-2xl font-semibold text-zinc-900">Dashboard sign in</h1>
          <p className="mt-2 text-sm text-zinc-600">
            Your API key is exchanged for a secure httpOnly session cookie. It is never stored in
            the browser.
          </p>
        </div>

        {/* 2026-08-06 (JS-disabled persona audit): same silent failure as
            /signup — no action, no method, no input names, so pressing
            "Continue" with JavaScript off just redisplayed an empty form. The
            key-for-session-cookie exchange is a fetch() POST by design (the key
            must never land in a URL), so state the requirement instead. */}
        <noscript>
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Signing in needs JavaScript: your API key is exchanged for a session cookie by a
            background request, deliberately never placed in the URL.
          </p>
        </noscript>

        <label className="block space-y-1 text-sm">
          <span className="font-medium text-zinc-700">API key</span>
          <input
            type="password"
            autoComplete="current-password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="vouch_live_..."
            className="w-full rounded-md border border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-500"
            required
          />
        </label>

        {error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {dashboardErrorMessage(error)}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
        >
          {loading ? "Signing in..." : "Continue"}
        </button>

        <p className="text-center text-sm text-zinc-600">
          No account?{" "}
          <a href="/signup" className="font-medium text-zinc-900 underline">
            Sign up free
          </a>
        </p>
      </form>
    </div>
  );
}
