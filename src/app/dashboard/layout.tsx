import type { Metadata } from "next";
import { DashboardShell } from "@/components/dashboard/shell";

export const metadata: Metadata = {
  // 2026-08-13 [m2]: 二重サフィックス解消（template が " | vet402" を付ける）。
  title: "Dashboard",
  description: "vet402 developer dashboard",
  // Authenticated operator UI. Indexing it splits crawl budget and can leak
  // key-shaped query strings from referrers; the public docs already cover
  // everything a search result should point at.
  robots: { index: false, follow: false },
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <DashboardShell>{children}</DashboardShell>;
}
