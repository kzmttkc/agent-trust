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

export function SiteChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isDashboard = pathname?.startsWith("/dashboard");

  if (isDashboard) {
    return <>{children}</>;
  }

  return (
    <>
      <SiteHeader />
      <div className="flex-1">{children}</div>
      <SiteFooter />
    </>
  );
}
