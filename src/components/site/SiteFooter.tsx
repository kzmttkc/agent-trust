/**
 * SiteFooter — standard footer (2026-07-20 company-wide header/footer standard).
 * Vouch is a stealth/pseudonymous Web3 product (mode B minimal disclosure,
 * see legal_requirements.md #4). Mode B withholds the operator's *personal*
 * identifiers (legal name, address, phone) — those stay disclosure-on-request.
 * It does not withhold the trade name: per brand.md (2026-07-31 Takeshi ruling,
 * which postdates legal_requirements.md), every product carries KIZUNA Creation
 * as the maker. The other two mode-B products already do — Soroi ships
 * "© {year} Soroi（KIZUNA Creation）" in its *English* locale and Verilot
 * "© {year} Verilot（KIZUNA Creation）" — so the same format is used here
 * verbatim, full-width parens and all. Contact remains email-only.
 * No billing is live yet, so no Legal Notice (tokushoho-equivalent)
 * link is shown — /legal/notice explains this and is linked from /legal/notice
 * itself once billing goes live.
 */

import Link from "next/link";

export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-zinc-200 bg-zinc-50">
      <div className="mx-auto max-w-6xl px-5 py-10 md:px-8">
        <div className="flex flex-col gap-8 md:flex-row md:justify-between">
          <div className="max-w-sm">
            <p className="font-semibold text-zinc-900">Vouch</p>
            <p className="mt-2 text-sm text-zinc-500">
              Trust layer for agent commerce. ERC-8004 agent trust scores on Base for x402 API providers.
            </p>
          </div>

          <nav aria-label="Sitemap" className="flex flex-col gap-2 text-sm">
            <Link href="/docs/api" className="text-zinc-600 hover:text-zinc-900">
              API reference
            </Link>
            {/* 2026-08-06 (JS-disabled persona audit): /accuracy and /leaderboard
                were reachable only through the header nav, which is `hidden
                md:flex` — below 768px it is display:none and the hamburger that
                replaces it needs JavaScript. On a narrow screen with JS off,
                the two pages that carry Vouch's whole differentiation (we
                publish our measured accuracy instead of hiding it) had zero
                in-site links pointing at them. The footer is server-rendered
                and always visible, so it is the right home for them. */}
            <Link href="/accuracy" className="text-zinc-600 hover:text-zinc-900">
              Accuracy
            </Link>
            <Link href="/leaderboard" className="text-zinc-600 hover:text-zinc-900">
              Leaderboard
            </Link>
            <Link href="/faq" className="text-zinc-600 hover:text-zinc-900">
              FAQ
            </Link>
            <Link href="/blog" className="text-zinc-600 hover:text-zinc-900">
              Blog
            </Link>
            <Link href="/dashboard" className="text-zinc-600 hover:text-zinc-900">
              Dashboard
            </Link>
            <Link href="/signup" className="text-zinc-600 hover:text-zinc-900">
              Get API key
            </Link>
          </nav>

          <nav aria-label="Legal and operator information" className="flex flex-col gap-2 text-sm">
            <Link href="/legal/terms" className="text-zinc-600 hover:text-zinc-900">
              Terms of Service
            </Link>
            <Link href="/legal/privacy" className="text-zinc-600 hover:text-zinc-900">
              Privacy Policy
            </Link>
            <Link href="/legal/notice" className="text-zinc-600 hover:text-zinc-900">
              Legal Notice
            </Link>
            <Link href="/legal/notice#contact" className="text-zinc-600 hover:text-zinc-900">
              Contact
            </Link>
          </nav>
        </div>

        <p className="mt-8 max-w-3xl text-xs leading-relaxed text-zinc-500">
          Vouch is offered for B2B API use by agent/service operators. Trust scores are informational
          only and do not constitute a guarantee, credit assessment, or legal certification.
        </p>

        <div className="mt-6 border-t border-zinc-200 pt-6 text-xs text-zinc-500">
          <p>© {year} Vouch（KIZUNA Creation）</p>
        </div>
      </div>
    </footer>
  );
}
