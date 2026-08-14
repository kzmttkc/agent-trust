// ============================================================
// vet402 Observatory L0 — daily catalog diff (design §3 step 3).
//
// Pure function: yesterday's key set + today's fetch → events. Kept free of
// DB/network so the false-delisting properties are provable in unit tests.
//
// Evidence rules:
//  - delisted   = in prev, absent today, endpoint not already delisted,
//                 AND today's fetch was complete. Absence during a fetch gap
//                 is not evidence of anything.
//  - relisted   = endpoint currently marked delisted, present today.
//                 Presence is positive evidence — valid even on a gap day.
//  - settle_drop = l30DaysTotalCalls fell ≥70% from a base ≥100. Both sides
//                 must exist; a drop is never inferred from missing data.
// ============================================================

/** Only bases at/above this call volume can produce settle_drop — below it a "drop" is noise. */
export const SETTLE_DROP_MIN_PREV_CALLS = 100;
/** Fractional fall (prev→current) at/above which settle_drop fires. */
export const SETTLE_DROP_RATIO = 0.7;

export type KnownEndpointState = {
  status: string; // active | delisted
  qualityCalls30d: number | null;
};

export type CatalogDiffInput = {
  /** Yesterday's resourceKey set; null = no previous snapshot (first run → no events). */
  prevKeys: ReadonlySet<string> | null;
  /** Today's resourceKey set. */
  currentKeys: ReadonlySet<string>;
  /** Whether today's fetch reached totalCount. false → delisting judgement withheld. */
  currentComplete: boolean;
  /** Current DB state per key (status + last stored 30d call count). */
  knownEndpoints: ReadonlyMap<string, KnownEndpointState>;
  /** Today's fetched 30d call count per key. */
  currentQuality: ReadonlyMap<string, number | null>;
};

export type CatalogDiffEvent = {
  resourceKey: string;
  eventType: "delisted" | "relisted" | "settle_drop";
  prevValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
};

export function computeCatalogDiff(input: CatalogDiffInput): CatalogDiffEvent[] {
  const { prevKeys, currentKeys, currentComplete, knownEndpoints, currentQuality } = input;

  // First run: nothing to compare against. Every endpoint is "new", and new
  // is not an event — the observatory reports changes, not existence.
  if (prevKeys === null) return [];

  const events: CatalogDiffEvent[] = [];

  // delisted — only when today's evidence is complete.
  if (currentComplete) {
    for (const key of prevKeys) {
      if (currentKeys.has(key)) continue;
      const known = knownEndpoints.get(key);
      // Already recorded as delisted → still absent is not a NEW event.
      if (known?.status === "delisted") continue;
      events.push({
        resourceKey: key,
        eventType: "delisted",
        prevValue: { status: "active" },
        newValue: { status: "delisted" },
      });
    }
  }

  for (const key of currentKeys) {
    const known = knownEndpoints.get(key);

    // relisted — positive evidence, valid even on an incomplete day.
    if (known?.status === "delisted") {
      events.push({
        resourceKey: key,
        eventType: "relisted",
        prevValue: { status: "delisted" },
        newValue: { status: "active" },
      });
      continue; // a just-relisted endpoint's call count is stale context; skip drop math
    }

    // settle_drop — both sides must be real numbers.
    const prevCalls = known?.qualityCalls30d ?? null;
    const curCalls = currentQuality.get(key) ?? null;
    if (prevCalls === null || curCalls === null) continue;
    if (prevCalls < SETTLE_DROP_MIN_PREV_CALLS) continue;
    if (curCalls > prevCalls * (1 - SETTLE_DROP_RATIO)) continue;
    events.push({
      resourceKey: key,
      eventType: "settle_drop",
      prevValue: { calls30d: prevCalls },
      newValue: { calls30d: curCalls },
    });
  }

  return events;
}
