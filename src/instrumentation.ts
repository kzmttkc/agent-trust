export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;

  // Skip full secret checks during `next build` when APP_ENV is unset — local
  // builds use NODE_ENV=production without production secrets. Explicit
  // APP_ENV=production (CI / Vercel) still validates at build time.
  const { assertProductionConfig } = await import("@/lib/config/env");
  if (
    process.env.npm_lifecycle_event === "build" &&
    process.env.APP_ENV !== "production"
  ) {
    return;
  }

  assertProductionConfig();
}
