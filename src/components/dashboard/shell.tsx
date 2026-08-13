"use client";

import Link from "next/link";
import { Wordmark } from "@/components/site/Wordmark";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { dashboardLogout } from "@/lib/dashboard/client";
import { buttonClass } from "@/components/ui/Button";

const nav = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/lookup", label: "Lookup" },
  { href: "/dashboard/settlements", label: "Settlements" },
  { href: "/dashboard/lists", label: "WL / BL" },
  { href: "/dashboard/logs", label: "Logs" },
  { href: "/dashboard/keys", label: "API Keys" },
  { href: "/dashboard/billing", label: "Billing" },
  { href: "/dashboard/integrations", label: "Integrations" },
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
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-zinc-50 px-6 text-sm text-zinc-600">
        <p>Loading dashboard...</p>
        {/* 2026-08-06 (JS-disabled persona audit): this is the server-rendered
            branch, so with JavaScript off the dashboard sat on "Loading
            dashboard..." forever — no error, no way to tell it was broken
            rather than slow. The dashboard is a client-rendered app against a
            session cookie, so it genuinely cannot work without JS; say so. */}
        <noscript>
          <p className="max-w-sm rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-center text-amber-900">
            The dashboard needs JavaScript and will not finish loading without it. The same data is
            available from the API — see the{" "}
            <a className="underline" href="/docs/api">
              API reference
            </a>
            .
          </p>
        </noscript>
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
            className={buttonClass({ className: "mt-4" })}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      {/* Skip link — the dashboard has its own chrome (SiteChrome is bypassed
          here), so it needs its own. Eight sidebar links otherwise sit between
          the top of the tab order and the page content on every view. */}
      <a
        href="#dashboard-main"
        className={buttonClass({ className: "sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50" })}
      >
        Skip to main content
      </a>
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div>
            {/* 2026-08-13: eyebrow をやめて実物のワードマークにした。
                craft-floor が見出しの上の kicker を明示的に禁じており、
                ここは製品名を出す唯一の場所なので識別体そのものを置く。 */}
            <Wordmark className="text-[1.0625rem] leading-none" />
            <h1 className="mt-1 font-[family-name:var(--font-display)] text-base font-semibold text-brand-deep">
              Developer Dashboard
            </h1>
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
                    ? "bg-brand-deep font-medium text-white"
                    : "text-zinc-700 hover:bg-zinc-200/70"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <main id="dashboard-main" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
