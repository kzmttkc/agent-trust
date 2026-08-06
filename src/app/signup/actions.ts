"use server";

import { cookies, headers } from "next/headers";
import { getClientIp } from "@/lib/api/ip-rate-limit";
import { dashboardCookieOptions } from "@/lib/dashboard/session";
import { runSignup } from "@/lib/dashboard/signup-core";

// 2026-08-06 (UX audit item 7 — progressive enhancement).
// A Server Action drives the SAME <form> as the JS fetch path. React renders
// this action as a native POST target during SSR, so with JavaScript disabled
// the browser submits the form to it directly (no silent no-op), and with JS
// enabled useActionState enhances it (no full navigation). Either way the
// email travels in the POST body — never a query string — which is exactly the
// privacy reason the earlier fix declined to add name attributes to a
// method-less form. Next's built-in same-origin check gates the action, and
// runSignup() reuses the identical rate limit / validation / creation path as
// the API route.

export type SignupState = {
  status: "idle" | "success" | "error";
  apiKey?: string;
  error?: string;
};

export async function signupAction(
  _prev: SignupState,
  formData: FormData,
): Promise<SignupState> {
  // Server-side backstop for the clickwrap consent: the checkbox is `required`
  // so the browser blocks native submit, but never trust the client to have
  // enforced it. An unchecked box has no value in FormData.
  if (formData.get("acceptedTerms") !== "on") {
    return { status: "error", error: "please_accept_the_terms_and_privacy_policy" };
  }

  const email = String(formData.get("email") ?? "").trim();
  const nameRaw = String(formData.get("name") ?? "").trim();
  const inviteRaw = String(formData.get("inviteCode") ?? "").trim();

  const requestHeaders = await headers();
  const ip = getClientIp(new Request("http://internal", { headers: requestHeaders }));

  const result = await runSignup(
    {
      email,
      name: nameRaw || undefined,
      inviteCode: inviteRaw || undefined,
    },
    ip,
  );

  if (!result.ok) {
    return { status: "error", error: result.error };
  }

  // Set the same httpOnly session cookie the API route sets, so a no-JS user
  // lands on the dashboard already authenticated.
  const cookieStore = await cookies();
  cookieStore.set(dashboardCookieOptions(result.sessionToken));

  return { status: "success", apiKey: result.apiKey };
}
