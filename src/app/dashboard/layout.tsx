import type { Metadata } from "next";
import { DashboardShell } from "@/components/dashboard/shell";

export const metadata: Metadata = {
  // 2026-08-13 [m2]: 二重サフィックス解消（template が " | vet402" を付ける）。
  title: "Dashboard",
  description: "vet402 developer dashboard",
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <DashboardShell>{children}</DashboardShell>;
}
