"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { markDashboardAuthenticated } from "@/lib/dashboard/client";
import { track } from "@/lib/analytics";
import { signupAction, type SignupState } from "./actions";

// 2026-08-06 growth: failure-reason allowlist for the signup_failed event.
// PII guard — analytics props must never carry user input (email/name/invite
// code). The API's error codes are all fixed snake_case constants (measured
// in src/lib/dashboard/signup-core.ts), and anything unrecognized maps to "other".
const KNOWN_SIGNUP_FAILURE_REASONS = new Set([
  "invalid_origin",
  "rate_limit_exceeded",
  "invalid_request",
  "invalid_invite_code",
  "email_already_registered",
  "database_unavailable",
  "signup_failed",
  "please_accept_the_terms_and_privacy_policy",
]);

function signupFailureReason(code: unknown): string {
  return typeof code === "string" && KNOWN_SIGNUP_FAILURE_REASONS.has(code)
    ? code
    : "other";
}

const INITIAL_STATE: SignupState = { status: "idle" };

export default function SignupPage() {
  const [inviteCode, setInviteCode] = useState("");
  const [inviteRequired, setInviteRequired] = useState(false);
  // 2026-08-06 (L5 legal review): explicit clickwrap consent — an unticked-by-
  // default checkbox that blocks submission is the form courts uphold. Kept in
  // client state only to drive the disabled button; the `required` attribute
  // gates the native (no-JS) submit and the Server Action re-checks server-side.
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  // 2026-08-06 (UX audit item 7): the form is now driven by a Server Action via
  // useActionState. Without JS the browser POSTs to the action natively and the
  // returned key renders server-side; with JS this enhances in place. This
  // replaced the fetch()-only handler that dead-ended when JS was disabled.
  const [state, formAction, pending] = useActionState(signupAction, INITIAL_STATE);
  const apiKey = state.status === "success" ? state.apiKey ?? null : null;

  useEffect(() => {
    fetch("/api/signup")
      .then((res) => res.json())
      .then((data) => setInviteRequired(Boolean(data.inviteRequired)))
      .catch(() => {});
  }, []);

  // 2026-08-06 growth: signup_view completes the form funnel. Mount-once.
  useEffect(() => {
    track("signup_view");
  }, []);

  // Fire the completion/failure analytics off the action result, once per
  // transition. (The JS path previously fired these inline in the fetch
  // handler; with useActionState the result arrives as state, so we react to
  // it here. No-JS users never run this — analytics needs JS by nature.)
  const reportedFor = useRef<SignupState | null>(null);
  useEffect(() => {
    if (state.status === "idle" || reportedFor.current === state) return;
    reportedFor.current = state;
    if (state.status === "success") {
      markDashboardAuthenticated();
      track("signup_completed");
    } else if (state.status === "error") {
      track("signup_failed", { reason: signupFailureReason(state.error) });
    }
  }, [state]);

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
          <p className="text-sm font-medium text-zinc-700">Try your first lookup</p>
          <p className="text-sm text-zinc-600">
            Score any wallet address (replace the placeholder below with a real one):
          </p>
          <pre className="overflow-x-auto rounded-lg border border-zinc-200 bg-zinc-900 p-4 text-xs text-zinc-100">
            <code>{curlExample}</code>
          </pre>
          <p className="text-sm text-zinc-600">
            Prefer the browser? Open any public{" "}
            <Link href="/payee/0xd8da6bf26964af9d7eed9e03e53415d37aa96045" className="underline">
              payee profile
            </Link>{" "}
            to see a live score, or read the{" "}
            <Link href="/docs/api" className="underline">
              API reference
            </Link>
            .
          </p>
        </div>

        {/* Plain link (not a router push) so this works with JS disabled too. */}
        <Link
          href="/dashboard"
          className="rounded-md bg-zinc-900 px-4 py-2 text-center text-sm font-medium text-white"
        >
          Go to dashboard
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-6 p-8">
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Vouch</p>
        {/* 2026-07-27 growth施策(週次): 見出しコピーのみ変更(フォーム項目・デザインは不変)。
            抽象的な製品説明から具体的なユースケース訴求へ。 */}
        <h1 className="text-3xl font-semibold">
          Know if the other side of an x402 payment can be trusted — in one API call, before you pay.
        </h1>
        <p className="text-sm text-zinc-600">
          Get an API key instantly. 1,000 score lookups per month on the Free plan.
        </p>
      </div>

      {/* 2026-08-06 (UX audit item 7): this form now submits with or without
          JavaScript. The Server Action is the form's action, the inputs carry
          name attributes, and the email travels in the POST body (never a query
          string), so a no-JS user gets their key on the next render instead of a
          silently wiped form. */}
      <noscript>
        <p className="rounded-md border border-zinc-300 bg-zinc-50 px-4 py-3 text-sm text-zinc-700">
          JavaScript is off — that is fine. Submitting will reload this page with your new API key
          shown once. Copy it before navigating away.
        </p>
      </noscript>

      <form
        action={formAction}
        onSubmit={() => track("signup_started")}
        className="space-y-4 rounded-xl border border-zinc-200 bg-white p-6"
      >
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Email</span>
          {/* autoComplete (WCAG 1.3.5 Identify Input Purpose) — lets the browser
              and assistive tech fill known values instead of retyping them. */}
          <input
            type="email"
            name="email"
            autoComplete="email"
            className="w-full rounded-md border border-zinc-300 px-3 py-2"
            required
          />
        </label>

        <label className="block space-y-1 text-sm">
          <span className="font-medium">Name (optional)</span>
          <input
            name="name"
            autoComplete="name"
            className="w-full rounded-md border border-zinc-300 px-3 py-2"
          />
        </label>

        {inviteRequired && (
          <label className="block space-y-1 text-sm">
            <span className="font-medium">Invite code</span>
            <input
              name="inviteCode"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              className="w-full rounded-md border border-zinc-300 px-3 py-2"
              required
            />
          </label>
        )}

        {/* Clickwrap consent. `required` makes the browser refuse the submit
            with its own message, so the gate works before any JS of ours runs
            AND on the no-JS native submit. stopPropagation on the two links: an
            <a> inside a <label> would otherwise toggle the checkbox on the way
            to the page the user actually asked for. */}
        <label
          htmlFor="accept-terms"
          className="flex cursor-pointer items-start gap-2 text-sm text-zinc-600"
        >
          <input
            id="accept-terms"
            name="acceptedTerms"
            type="checkbox"
            checked={acceptedTerms}
            onChange={(e) => setAcceptedTerms(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-zinc-300"
            required
          />
          <span>
            I have read and agree to the{" "}
            <Link href="/legal/terms" className="underline" onClick={(e) => e.stopPropagation()}>
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link href="/legal/privacy" className="underline" onClick={(e) => e.stopPropagation()}>
              Privacy Policy
            </Link>
            .
          </span>
        </label>

        {state.status === "error" && state.error && (
          <p className="text-sm text-red-600">{state.error.replaceAll("_", " ")}</p>
        )}

        <button
          type="submit"
          disabled={pending || !acceptedTerms}
          className="w-full rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {pending ? "Creating..." : "Create account"}
        </button>
      </form>

      <p className="text-center text-sm text-zinc-600">
        Already have a key?{" "}
        <Link href="/dashboard/login" className="font-medium text-zinc-900 underline">
          Sign in
        </Link>
      </p>
    </main>
  );
}
