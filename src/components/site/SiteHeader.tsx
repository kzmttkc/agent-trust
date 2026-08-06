"use client";

/**
 * SiteHeader — standard header (2026-07-20 company-wide header/footer standard).
 * Ported from output/0720/header_footer_standard/SiteHeader.tsx.
 * Vouch is Web3/stealth (pseudonymous), English-only, so no product name
 * localization or language switcher is needed here.
 */

import { useEffect, useRef, useState } from "react";
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
  const toggleRef = useRef<HTMLButtonElement>(null);

  // 2026-08-06 a11y (keyboard persona audit): the mobile panel could be opened
  // but Escape did nothing, so a keyboard user had to tab back through the
  // whole drawer to dismiss it. Deliberately NOT a focus trap: this is an
  // inline disclosure, not a modal (no role="dialog", no aria-modal, no inert,
  // body scroll untouched), and ARIA APG does not want a trap here — Escape
  // plus returning focus to the toggle is the whole contract.
  useEffect(() => {
    if (!mobileOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setMobileOpen(false);
      toggleRef.current?.focus();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mobileOpen]);

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
          {/* 2026-08-06 a11y: `transition` (and `transition-colors`) include
              outline-color in Tailwind v4, so the focus ring on this dark
              button faded in over 150ms from white — mid-transition contrast
              against the zinc-900 background is 1.00:1, i.e. invisible at the
              exact moment a keyboard user needs it. Only the background
              actually animates here, so name it explicitly. */}
          <Link
            href="/signup"
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-[background-color] hover:bg-zinc-800"
          >
            Get API key
          </Link>
        </div>

        <button
          ref={toggleRef}
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
        // 2026-08-06 (landscape persona audit A-2): the open drawer made this
        // sticky header 422px tall. A sticky element taller than the viewport
        // does not move when you scroll, so on any phone in landscape (320-430px
        // tall) the bottom of the drawer — Dashboard and the primary "Get API
        // key" CTA — was permanently off-screen and physically untappable.
        // Capping the drawer at the space below the 4rem bar and letting it
        // scroll internally makes every item reachable at any viewport height.
        <nav
          aria-label="Mobile navigation"
          className="flex max-h-[calc(100dvh-4rem)] flex-col gap-1 overflow-y-auto overscroll-contain border-t border-zinc-200 bg-white px-5 py-4 md:hidden"
        >
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
