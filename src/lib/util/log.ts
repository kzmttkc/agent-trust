export function logServerError(context: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[vouch] ${context}: ${message}`);
}
