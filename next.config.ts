import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// Next.js (App Router) ships an inline bootstrap script for RSC hydration and
// the dashboard renders one dynamic inline style (progress bar width), so
// script-src/style-src need 'unsafe-inline' rather than a strict nonce here —
// this file only adds static headers, no middleware/nonce plumbing.
// Dev additionally needs 'unsafe-eval' + a websocket allowance for Turbopack HMR.
const cspDirectives = [
  `default-src 'self'`,
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  `style-src 'self' 'unsafe-inline'`,
  `img-src 'self' data:`,
  `font-src 'self' data:`,
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  `frame-src 'none'`,
  `frame-ancestors 'none'`,
  `form-action 'self'`,
  `base-uri 'self'`,
  `object-src 'none'`,
];

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Content-Security-Policy", value: cspDirectives.join("; ") },
];

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
