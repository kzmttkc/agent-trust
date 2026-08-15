/** Copy for the public outage strip. `ok` and unknown statuses produce nothing. */
export function livenessBannerMessage(status: string | undefined): string | null {
  if (status === "error") {
    return "Scoring is failing upstream — payee and agent lookups return no score right now.";
  }
  if (status === "degraded") {
    return "Upstream indexer degraded — payee lookups may return “not verifiable”.";
  }
  return null;
}
