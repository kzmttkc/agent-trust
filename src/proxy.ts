import { NextRequest, NextResponse } from "next/server";

const isDev = process.env.NODE_ENV !== "production";

// Per-request nonce-based CSP for script-src (replaces 'unsafe-inline').
// Next.js's own RSC hydration bootstrap script picks up this nonce
// automatically once it's present in the outgoing CSP header; custom inline
// scripts (e.g. JSON-LD in src/app/faq and src/app/blog/[slug]) read the
// nonce via `headers()` in a Server Component and set it explicitly.
//
// Nonces must be unique per request, so any route that renders an inline
// <script> (including the framework's own bootstrap script) must be
// dynamically rendered — see src/app/layout.tsx.
function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function proxy(request: NextRequest) {
  const nonce = generateNonce();

  const cspDirectives = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data:`,
    `font-src 'self' data:`,
    // https://plausible.io: 2026-07-22 全社日次反応レポート向け計装。script自体は
    // strict-dynamic下でNextのnonce付きランタイムからの動的挿入として許可されるが、
    // ビーコン送信(fetch/XHR)は connect-src が別途governs するため明示許可が必須。
    `connect-src 'self' https://plausible.io${isDev ? " ws: wss:" : ""}`,
    `frame-src 'none'`,
    `frame-ancestors 'none'`,
    `form-action 'self'`,
    `base-uri 'self'`,
    `object-src 'none'`,
  ];
  const contentSecurityPolicy = cspDirectives.join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set("Content-Security-Policy", contentSecurityPolicy);

  return response;
}

export const config = {
  matcher: "/:path*",
};
