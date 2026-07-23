"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { markDashboardAuthenticated } from "@/lib/dashboard/client";
import { track } from "@/lib/analytics";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [inviteRequired, setInviteRequired] = useState(false);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/signup")
      .then((res) => res.json())
      .then((data) => setInviteRequired(Boolean(data.inviteRequired)))
      .catch(() => {});
  }, []);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    track("signup_started");

    try {
      const response = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email: email.trim(),
          name: name.trim() || undefined,
          inviteCode: inviteCode.trim() || undefined,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? "signup_failed");
        track("signup_failed");
        return;
      }

      setApiKey(data.apiKey);
      markDashboardAuthenticated();
      track("signup_completed");
    } catch {
      setError("connection_failed");
      track("signup_failed");
    } finally {
      setLoading(false);
    }
  }

  if (apiKey) {
    // Fallback URL is the current production deployment. A custom domain
    // (e.g. api.vouch.dev) is not registered yet — replace this once it is.
    const base =
      typeof window !== "undefined"
        ? `${window.location.origin}/api/v1`
        : "https://agent-trust-tawny.vercel.app/api/v1";
    const curlExample = `curl -H "Authorization: Bearer ${apiKey}" \\
  ${base}/wallets/0x1234567890123456789012345678901234567890/score`;

    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-6 p-8">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">Your API key</h1>
          <p className="text-sm text-zinc-600">
            Copy this key now. It will not be shown again. You are signed in to the dashboard.
          </p>
        </div>
        <code className="block break-all rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-xs">
          {apiKey}
        </code>

        <div className="space-y-2">
          <p className="text-sm font-medium text-zinc-700">Try it now</p>
          <p className="text-sm text-zinc-600">
            Score any wallet address (replace the placeholder below with a real one):
          </p>
          <pre className="overflow-x-auto rounded-lg border border-zinc-200 bg-zinc-900 p-4 text-xs text-zinc-100">
            <code>{curlExample}</code>
          </pre>
        </div>

        <button
          type="button"
          onClick={() => router.push("/dashboard")}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white"
        >
          Go to dashboard
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-6 p-8">
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Vouch</p>
        <h1 className="text-3xl font-semibold">Create free account</h1>
        <p className="text-sm text-zinc-600">
          Get an API key instantly. 1,000 score lookups per month on the Free plan.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-4 rounded-xl border border-zinc-200 bg-white p-6">
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-zinc-300 px-3 py-2"
            required
          />
        </label>

        <label className="block space-y-1 text-sm">
          <span className="font-medium">Name (optional)</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md border border-zinc-300 px-3 py-2"
          />
        </label>

        {inviteRequired && (
          <label className="block space-y-1 text-sm">
            <span className="font-medium">Invite code</span>
            <input
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              className="w-full rounded-md border border-zinc-300 px-3 py-2"
              required
            />
          </label>
        )}

        {error && <p className="text-sm text-red-600">{error.replaceAll("_", " ")}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {loading ? "Creating..." : "Create account"}
        </button>
      </form>

      <p className="text-center text-sm text-zinc-600">
        Already have a key?{" "}
        <Link href="/dashboard/login" className="font-medium text-zinc-900 underline">
          Sign in
        </Link>
      </p>

      <p className="text-center text-xs text-zinc-500">
        By signing up you agree to our{" "}
        <Link href="/legal/terms" className="underline">
          Terms
        </Link>{" "}
        and{" "}
        <Link href="/legal/privacy" className="underline">
          Privacy Policy
        </Link>
        .
      </p>
    </main>
  );
}
