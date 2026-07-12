export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;
  if (process.env.npm_lifecycle_event === "build") return;

  const { assertProductionConfig } = await import("@/lib/config/env");
  assertProductionConfig();
}
