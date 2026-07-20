/**
 * SiteFooter — standard footer (2026-07-20 company-wide header/footer standard).
 * Vouch is a stealth/pseudonymous Web3 product (mode B minimal disclosure,
 * see legal_requirements.md #4). No entity name is shown; contact is via
 * email only. No billing is live yet, so no Legal Notice (tokushoho-equivalent)
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

        <p className="mt-8 max-w-3xl text-xs leading-relaxed text-zinc-400">
          Vouch is offered for B2B API use by agent/service operators. Trust scores are informational
          only and do not constitute a guarantee, credit assessment, or legal certification.
        </p>

        <div className="mt-6 border-t border-zinc-200 pt-6 text-xs text-zinc-400">
          <p>© {year} Vouch</p>
        </div>
      </div>
    </footer>
  );
}
