"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { dashboardLogout } from "@/lib/dashboard/client";

const nav = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/lookup", label: "Lookup" },
  { href: "/dashboard/lists", label: "WL / BL" },
  { href: "/dashboard/logs", label: "Logs" },
  { href: "/dashboard/keys", label: "API Keys" },
  { href: "/dashboard/billing", label: "Billing" },
];

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isLogin = pathname === "/dashboard/login";
  const [ready, setReady] = useState(isLogin);
  const [serviceError, setServiceError] = useState<string | null>(null);

  useEffect(() => {
    if (isLogin) return;

    let cancelled = false;

    fetch("/api/dashboard/overview", { credentials: "include" })
      .then(async (response) => {
        if (cancelled) return;

        if (response.status === 401 || response.status === 403) {
          router.replace("/dashboard/login");
          return;
        }

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          setServiceError(data.error ?? "service_unavailable");
          setReady(true);
          return;
        }

        setReady(true);
      })
      .catch(() => {
        if (!cancelled) {
          setServiceError("connection_failed");
          setReady(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isLogin, router]);

  async function logout() {
    await dashboardLogout();
    router.push("/dashboard/login");
  }

  if (isLogin) {
    return <>{children}</>;
  }

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 text-sm text-zinc-600">
        Loading dashboard...
      </div>
    );
  }

  if (serviceError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-6">
        <div className="max-w-md rounded-xl border border-red-200 bg-white p-6 text-center">
          <p className="text-sm text-red-700">Dashboard unavailable: {serviceError}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 rounded-md bg-zinc-900 px-4 py-2 text-sm text-white"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Vouch</p>
            <h1 className="text-lg font-semibold">Developer Dashboard</h1>
          </div>
          <button
            type="button"
            onClick={logout}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100"
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-6 px-6 py-6 lg:grid-cols-[220px_1fr]">
        <nav className="space-y-1">
          {nav.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`block rounded-md px-3 py-2 text-sm ${
                  active
                    ? "bg-zinc-900 font-medium text-white"
                    : "text-zinc-700 hover:bg-zinc-200/70"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <main>{children}</main>
      </div>
    </div>
  );
}
