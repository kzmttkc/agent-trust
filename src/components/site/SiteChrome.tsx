"use client";

/**
 * Wraps children with the standard marketing SiteHeader/SiteFooter, except on
 * /dashboard/*, which already renders its own app shell (DashboardShell) with
 * its own top nav — stacking the marketing header/footer there would double
 * up navigation chrome and break the dashboard layout.
 */

import { usePathname } from "next/navigation";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { buttonClass } from "@/components/ui/Button";

export function SiteChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isDashboard = pathname?.startsWith("/dashboard");

  if (isDashboard) {
    return <>{children}</>;
  }

  return (
    <>
      {/* 2026-08-06 a11y (keyboard persona audit): there was no skip link
          anywhere on the site (zero in-page anchors, and <main> had no id), so
          every keyboard and screen-reader user tabbed through 9 header links
          before reaching the content — on every single page. Standard pattern:
          visually hidden until focused, first element in the tab order. The
          target needs tabIndex={-1} because a plain <div> is not focusable and
          some browsers would otherwise scroll without moving focus. */}
      <a
        href="#main-content"
        className={buttonClass({ className: "sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50" })}
      >
        Skip to main content
      </a>
      <SiteHeader />
      <div id="main-content" tabIndex={-1} className="flex-1">
        {children}
      </div>
      <SiteFooter />
    </>
  );
}
