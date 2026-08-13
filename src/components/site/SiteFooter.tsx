/**
 * SiteFooter — the page foot of the document.
 *
 * 2026-08-13 vet402: the three-part RFC page foot
 * (`vet402 · Building in public · [Page 1]`) closes every page, under the
 * double rule that opens a memo's back matter. The index below it is set as an
 * RFC index, not as a marketing sitemap.
 *
 * Vouch is a stealth/pseudonymous Web3 product (mode B minimal disclosure,
 * see legal_requirements.md #4). Mode B withholds the operator's *personal*
 * identifiers (legal name, address, phone) — those stay disclosure-on-request.
 * It does not withhold the trade name: per brand.md (2026-07-31 Takeshi ruling,
 * which postdates legal_requirements.md), every product carries KIZUNA Creation
 * as the maker. Vouch has no locale switching — it is English throughout — so
 * it follows Banto's English-locale page, which renders the credit in ASCII
 * parens. Contact remains email-only. No billing is live yet, so no Legal
 * Notice (tokushoho-equivalent) link is shown — /legal/notice explains this.
 */

import Link from "next/link";
import { Wordmark } from "@/components/site/Wordmark";

const INDEX_LINKS = [
  { label: "Verify a payee", href: "/payee" },
  { label: "Measured accuracy", href: "/accuracy" },
  { label: "API reference", href: "/docs/api" },
  // 2026-08-06 (JS-disabled persona audit): /accuracy and /leaderboard were
  // reachable only through the header nav, which is `hidden md:flex` — below
  // 768px it is display:none and the hamburger that replaces it needs
  // JavaScript. The footer is server-rendered and always visible, so it is the
  // right home for them.
  { label: "Leaderboard", href: "/leaderboard" },
  { label: "FAQ", href: "/faq" },
  { label: "Blog", href: "/blog" },
];

const OPERATOR_LINKS = [
  { label: "Get an API key", href: "/signup" },
  { label: "Dashboard", href: "/dashboard" },
  { label: "Terms of Service", href: "/legal/terms" },
  { label: "Privacy Policy", href: "/legal/privacy" },
  { label: "Legal Notice", href: "/legal/notice" },
  { label: "Contact", href: "/legal/notice#contact" },
];

export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    // ヘッダと同じ式で紙面の本文列に揃える（外は main と同じ余白、内は .sheet と
    // 同じ余白）。奥付が本文と同じ走り出しに乗る。
    <footer className="mt-16 bg-ground px-4 pb-12 sm:px-6 md:px-8">
      <div className="mx-auto w-full max-w-[var(--column)] px-[var(--sheet-pad)] pt-1">
        <div className="rule-double" />

        {/* RFC page foot — three parts, left / centre / right. */}
        <div className="flex items-baseline justify-between gap-3 pt-3 text-[0.8125rem] text-brand-lift">
          <Wordmark className="text-[0.8125rem]" />
          <span className="hidden sm:inline">Building in public</span>
          <span>[Page 1]</span>
        </div>

        <div className="mt-10 grid gap-8 sm:grid-cols-2">
          <nav aria-label="Document index">
            <p className="doc-caption">Index</p>
            <ul className="mt-4 space-y-2 text-[0.8125rem]">
              {INDEX_LINKS.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="text-brand hover:text-brand-deep">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-label="Legal and operator information">
            <p className="doc-caption">Operator</p>
            <ul className="mt-4 space-y-2 text-[0.8125rem]">
              {OPERATOR_LINKS.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="text-brand hover:text-brand-deep">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <p className="mt-10 max-w-[72ch] text-xs leading-relaxed text-brand-lift">
          vet402 is offered for B2B API use by agent and service operators. Verification results and
          scores are informational only and do not constitute a guarantee, credit assessment, or
          legal certification.
        </p>

        <div className="mt-6 border-t border-hair pt-5 text-xs text-brand-lift">
          <p>© {year} vet402 (KIZUNA Creation)</p>
        </div>
      </div>
    </footer>
  );
}
