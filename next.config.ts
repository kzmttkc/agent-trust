import type { NextConfig } from "next";

// Content-Security-Policy is no longer set here: it now needs a fresh
// per-request nonce for script-src (replacing 'unsafe-inline'), so it's
// generated and applied in src/proxy.ts instead. The dashboard's one
// dynamic inline style (progress bar width) still relies on
// style-src 'unsafe-inline', which src/proxy.ts also sets.
const securityHeaders = [
  // 2026-08-13 監査 L-1: これまでは Vercel 既定の max-age のみ（includeSubDomains/
  // preload なし）に依存していた。自前で明示し、サブドメインへの平文格下げ攻撃も
  // 塞ぐ。preload は hstspreload.org への登録自体は別途手続きだが、登録要件である
  // このトークンを先に配っておく。
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // 2026-08-06: Vouch was the only one of the three products without this
  // header (Verilot has carried it since 2026-07-22). None of these APIs are
  // used anywhere in the app, so denying them outright costs nothing and
  // removes them from any injected/embedded content's reach.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
];

const nextConfig: NextConfig = {
  // 2026-08-05 R&D audit: the three products' headers were compared and Vouch
  // was the only one still advertising its framework. Zero functional value,
  // and a product that sells itself as a trust layer should not volunteer
  // fingerprinting hints it does not have to.
  poweredByHeader: false,
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
  // 2026-08-06 (JS-disabled / navigation audit): the header's "Pricing" item
  // points at the in-page anchor /#pricing, but developers type URLs directly
  // and inbound links get written as /pricing — which returned a hard 404. The
  // pricing table itself is server-rendered on the homepage, so a redirect is
  // the whole fix. Kept temporary (307) rather than 308 so that promoting
  // pricing to a real page later isn't fighting a permanently cached redirect.
  async redirects() {
    return [
      {
        source: "/pricing",
        destination: "/#pricing",
        permanent: false,
      },
      // 2026-08-13 UX監査R1 [B2]: 旧 Vercel ドメイン
      // agent-trust-tawny.vercel.app が本番とバイト同一の複製を配信し続けて
      // いた（実測: HTTP 200、同じ HTML）。GitHub リポの homepage も当時そこを
      // 指していた。同じ文書が2つの正典を持つと、被リンクと索引が割れるだけ
      // でなく、「どちらが本物か」を読者が判定できない — 検証を売る製品が
      // 自分の身元で それをやっているのは、llms.txt が第三者ドメインを
      // 否認しているのと辻褄が合わない。
      //
      // ホスト一致の恒久リダイレクト。パスは保存する（旧ドメインの深いリンクが
      // トップに落ちない）。308 = permanent:true で、メソッドと本文を保つ
      // （301 は POST を GET に変える）。
      {
        source: "/:path*",
        has: [{ type: "host", value: "agent-trust-tawny.vercel.app" }],
        destination: "https://vet402.com/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
