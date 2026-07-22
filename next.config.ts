import type { NextConfig } from "next";

// Content-Security-Policy is no longer set here: it now needs a fresh
// per-request nonce for script-src (replacing 'unsafe-inline'), so it's
// generated and applied in src/proxy.ts instead. The dashboard's one
// dynamic inline style (progress bar width) still relies on
// style-src 'unsafe-inline', which src/proxy.ts also sets.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
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
