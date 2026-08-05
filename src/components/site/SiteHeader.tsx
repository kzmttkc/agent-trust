"use client";

/**
 * SiteHeader — standard header (2026-07-20 company-wide header/footer standard).
 * Ported from output/0720/header_footer_standard/SiteHeader.tsx.
 * Vouch is Web3/stealth (pseudonymous), English-only, so no product name
 * localization or language switcher is needed here.
 */

import { useState } from "react";
import Link from "next/link";

type NavItem = { label: string; href: string };

const NAV_ITEMS: NavItem[] = [
  { label: "Docs", href: "/docs/api" },
  { label: "Accuracy", href: "/accuracy" },
  { label: "Leaderboard", href: "/leaderboard" },
  { label: "FAQ", href: "/faq" },
  { label: "Blog", href: "/blog" },
  { label: "Pricing", href: "/#pricing" },
];

export function SiteHeader() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 md:px-8">
        <Link href="/" className="flex shrink-0 items-center gap-2 font-semibold text-zinc-900">
          <span>Vouch</span>
        </Link>

        <nav aria-label="Main navigation" className="hidden items-center gap-6 text-sm text-zinc-600 md:flex">
          {NAV_ITEMS.map((item) => (
            <Link key={item.href} href={item.href} className="hover:text-zinc-900">
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-4 md:flex">
          <Link href="/dashboard/login" className="text-sm text-zinc-600 hover:text-zinc-900">
            Dashboard
          </Link>
          <Link
            href="/signup"
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800"
          >
            Get API key
          </Link>
        </div>

        <button
          type="button"
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          aria-expanded={mobileOpen}
          className="flex h-9 w-9 items-center justify-center rounded-md md:hidden"
          onClick={() => setMobileOpen((v) => !v)}
        >
          <span className="sr-only">Menu</span>
          <span className="flex flex-col gap-1.5">
            <span className="block h-0.5 w-5 bg-zinc-900" />
            <span className="block h-0.5 w-5 bg-zinc-900" />
            <span className="block h-0.5 w-5 bg-zinc-900" />
          </span>
        </button>
      </div>

      {mobileOpen ? (
        <nav aria-label="Mobile navigation" className="flex flex-col gap-1 border-t border-zinc-200 bg-white px-5 py-4 md:hidden">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-2 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
              onClick={() => setMobileOpen(false)}
            >
              {item.label}
            </Link>
          ))}
          <Link
            href="/dashboard/login"
            className="rounded-md px-2 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
            onClick={() => setMobileOpen(false)}
          >
            Dashboard
          </Link>
          <Link
            href="/signup"
            className="mt-2 rounded-md bg-zinc-900 px-4 py-2 text-center text-sm font-medium text-white"
            onClick={() => setMobileOpen(false)}
          >
            Get API key
          </Link>
        </nav>
      ) : null}
    </header>
  );
}
