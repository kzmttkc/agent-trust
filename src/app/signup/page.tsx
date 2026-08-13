"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { markDashboardAuthenticated } from "@/lib/dashboard/client";
import { track } from "@/lib/analytics";
import { signupAction, type SignupState } from "./actions";
import { buttonClass } from "@/components/ui/Button";

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
      <main className="px-4 pt-8 pb-4 sm:px-6 md:px-8 md:pt-12">
        <article className="sheet">
          <div className="doc-head">
            <div className="doc-head-col">
              <span>Access granted</span>
              <span>
                {/* この頁のシアン1点。1回しか出ないという事実。 */}
                Secret: <span className="text-signal">shown once</span>
              </span>
            </div>
            <div className="doc-head-col">
              <span>vet402</span>
              <span>Signed in</span>
            </div>
          </div>

          <h1 className="doc-title mt-10">Your API key</h1>
          <div className="rule-double mx-auto mt-6 w-full max-w-[34ch]" />

          <p className="doc-p mt-8">
            Copy this key now. <strong>It will not be shown again.</strong> You are signed in to the
            dashboard.
          </p>
          <code className="mt-4 block break-all border border-dashed border-brand-lift bg-paper px-4 py-3 text-[0.8125rem] text-brand-deep">
            {apiKey}
          </code>

          <h2 className="sec-head">
            <span className="sec-no">1.</span>
            <span>Try your first lookup</span>
          </h2>
          <p className="doc-p">
            Score any wallet address (replace the placeholder below with a real one):
          </p>
          <pre className="mt-4 overflow-x-auto rounded-[2px] bg-brand-deep p-4 text-xs leading-relaxed text-ground">
            <code>{curlExample}</code>
          </pre>
          <p className="doc-p">
            Prefer the browser? Open any public{" "}
            <Link href="/payee" className="doc-link">
              payee profile
            </Link>{" "}
            to see a live score, or read the{" "}
            <Link href="/docs/api" className="doc-link">
              API reference
            </Link>
            .
          </p>
          <div className="mt-8">

          {/* Plain link (not a router push) so this works with JS disabled too. */}
          <Link href="/dashboard" className={buttonClass({ size: "md" })}>
            Go to dashboard
          </Link>
          </div>
        </article>
      </main>
    );
  }

  return (
    <main className="px-4 pt-8 pb-4 sm:px-6 md:px-8 md:pt-12">
      <article className="sheet">
        <div className="doc-head">
          <div className="doc-head-col">
            <span>Access request</span>
            <span>
              {/* この頁のシアン1点。無料枠という事実。 */}
              Tier: <span className="text-signal">Free — 1,000 lookups / month</span>
            </span>
          </div>
          <div className="doc-head-col">
            <span>vet402</span>
            <span>No card required</span>
          </div>
        </div>

        {/* 2026-07-27 growth施策(週次): 見出しコピーは 2026-07-27 のもののまま。
            2026-08-13 の改装では組版だけを直し、文言には触れていない
            （抽象的な製品説明から具体的なユースケース訴求へ、という判断を保つ）。
            eyebrow の "Vouch" は削除した — craft-floor が kicker/eyebrow を
            明示的に禁じており、ワードマークは走り出しに既に在る。 */}
        <h1 className="doc-title mt-10 max-w-[42ch]">
          Know if the other side of an x402 payment can be trusted — in one API call, before you
          pay.
        </h1>
        <p className="mx-auto mt-3 max-w-[56ch] text-center text-brand-lift">
          Get an API key instantly. 1,000 score lookups per month on the Free plan.
        </p>
        <div className="rule-double mx-auto mt-6 w-full max-w-[34ch]" />

      {/* 2026-08-06 (UX audit item 7): this form now submits with or without
          JavaScript. The Server Action is the form's action, the inputs carry
          name attributes, and the email travels in the POST body (never a query
          string), so a no-JS user gets their key on the next render instead of a
          silently wiped form. */}
      <noscript>
        <p className="mt-8 border border-dashed border-brand-lift px-4 py-3 text-[0.8125rem] text-brand-deep">
          JavaScript is off — that is fine. Submitting will reload this page with your new API key
          shown once. Copy it before navigating away.
        </p>
      </noscript>

      <form
        action={formAction}
        onSubmit={() => track("signup_started")}
        className="mt-10 space-y-5 border-t border-brand-deep pt-8"
      >
        {/* 2026-08-12: 入力欄の枠線は白地 3:1 を満たす階調でなければならない。
            それまでの zinc-300 (#D4D4D8) は白地 1.48:1 で、WCAG 2.2 の 1.4.11
            （非テキストコントラスト 3:1）を満たしていなかった。この枠線が入力欄の
            唯一の境界表現なので免除されない。
            2026-08-13 vet402: 紺の階調へ移して brand-lift (#55688c・白地 5.61:1)。
            brand-mist (#8f9cb2) は 2.78:1 なので枠線には使えない。
            tests/contrast-tokens.test.ts が入力欄の弱い枠線を静的に禁じている。 */}
        <label className="block space-y-2 text-sm">
          <span className="doc-caption block">Email</span>
          {/* autoComplete (WCAG 1.3.5 Identify Input Purpose) — lets the browser
              and assistive tech fill known values instead of retyping them. */}
          <input
            type="email"
            name="email"
            autoComplete="email"
            className="w-full rounded-[2px] border border-brand-lift bg-paper px-3 py-2.5 text-brand-deep"
            required
          />
        </label>

        <label className="block space-y-2 text-sm">
          <span className="doc-caption block">Name (optional)</span>
          <input
            name="name"
            autoComplete="name"
            className="w-full rounded-[2px] border border-brand-lift bg-paper px-3 py-2.5 text-brand-deep"
          />
        </label>

        {inviteRequired && (
          <label className="block space-y-2 text-sm">
            <span className="doc-caption block">Invite code</span>
            <input
              name="inviteCode"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              className="w-full rounded-[2px] border border-brand-lift bg-paper px-3 py-2.5 text-brand-deep"
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
          className="flex cursor-pointer items-start gap-3 text-[0.8125rem] text-brand"
        >
          <input
            id="accept-terms"
            name="acceptedTerms"
            type="checkbox"
            checked={acceptedTerms}
            onChange={(e) => setAcceptedTerms(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 rounded-[2px] border-brand-lift accent-brand-deep"
            required
          />
          <span>
            I have read and agree to the{" "}
            <Link href="/legal/terms" className="doc-link" onClick={(e) => e.stopPropagation()}>
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link href="/legal/privacy" className="doc-link" onClick={(e) => e.stopPropagation()}>
              Privacy Policy
            </Link>
            .
          </span>
        </label>

        {state.status === "error" && state.error && (
          <p role="alert" className="border-l-[3px] border-red-700 bg-red-50 px-4 py-3 text-[0.8125rem] text-red-800">{state.error.replaceAll("_", " ")}</p>
        )}

        <button
          type="submit"
          disabled={pending || !acceptedTerms}
          className={buttonClass({ size: "md", className: "w-full" })}
        >
          {pending ? "Creating..." : "Create account"}
        </button>
      </form>

      <p className="mt-8 text-center text-[0.8125rem] text-brand">
          Already have a key?{" "}
          <Link href="/dashboard/login" className="doc-link">
            Sign in
          </Link>
        </p>
      </article>
    </main>
  );
}
