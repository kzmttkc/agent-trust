"use client";

const SESSION_FLAG = "vouch_dashboard_authenticated";

/** Optional UX hint only — access control uses httpOnly session cookies. */
export function markDashboardAuthenticated(): void {
  if (typeof window !== "undefined") {
    sessionStorage.setItem(SESSION_FLAG, "1");
  }
}

export function clearDashboardAuthenticated(): void {
  if (typeof window !== "undefined") {
    sessionStorage.removeItem(SESSION_FLAG);
  }
}

export async function dashboardFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "include",
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error ?? "request_failed");
  }

  return data as T;
}

export async function dashboardLogout(): Promise<void> {
  await fetch("/api/dashboard/session", { method: "DELETE", credentials: "include" });
  clearDashboardAuthenticated();
}
