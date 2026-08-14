// ============================================================
// vet402 Observatory L0 — delisting notifications (design §6.2).
//
// Runs right after catalog-sync. Selects unnotified `delisted` events, joins
// endpoint.payTo → x402_payee_watchers.wallet (both lowercased at write
// time), and delivers `endpoint.delisted` through the EXISTING webhook stack
// — HMAC signing, SSRF re-validation, failure auto-disable all apply
// unchanged. notified=true is the double-send guard; events with no watcher
// are marked too, so the queue stays bounded and a later claimant starts
// from fresh events rather than a backfill flood.
//
// The payload is facts only (legal gate): what was listed, when it stopped
// being listed, and where the history lives. It is explicitly NOT a
// judgement about the operator.
// ============================================================
import { eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { isMissingSchemaError } from "@/lib/db/pg-errors";
import {
  x402DelistingEvents,
  x402Endpoints,
  x402PayeeWatchers,
} from "@/lib/db/schema";
import { dispatchWebhookEvent, type WebhookEvent } from "@/lib/webhooks";
import { SITE_URL } from "@/lib/site-url";

export type NotifySummary = {
  /** Events examined and marked notified this run. */
  processed: number;
  /** (event, apiKey) deliveries handed to the webhook dispatcher. */
  dispatched: number;
};

type DispatchFn = (
  apiKeyId: string | null,
  eventType: WebhookEvent,
  payload: unknown,
) => Promise<void>;

/** Cap per run — a catastrophic catalog day must not turn into an unbounded delivery storm. */
const MAX_EVENTS_PER_RUN = 500;

export async function notifyDelistedEvents(
  options: { dispatch?: DispatchFn } = {},
): Promise<NotifySummary> {
  const dispatch = options.dispatch ?? dispatchWebhookEvent;
  const db = getDb();
  if (!db) return { processed: 0, dispatched: 0 };

  try {
    const events = await db
      .select({
        id: x402DelistingEvents.id,
        endpointId: x402DelistingEvents.endpointId,
        detectedOn: x402DelistingEvents.detectedOn,
        prevValue: x402DelistingEvents.prevValue,
        newValue: x402DelistingEvents.newValue,
        resourceKey: x402Endpoints.resourceKey,
        resourceUrl: x402Endpoints.resourceUrl,
        payTo: x402Endpoints.payTo,
        lastSeenAt: x402Endpoints.lastSeenAt,
      })
      .from(x402DelistingEvents)
      .innerJoin(x402Endpoints, eq(x402DelistingEvents.endpointId, x402Endpoints.id))
      .where(
        sql`${x402DelistingEvents.notified} = false AND ${x402DelistingEvents.eventType} = 'delisted'`,
      )
      .limit(MAX_EVENTS_PER_RUN);

    if (events.length === 0) return { processed: 0, dispatched: 0 };

    // One watcher lookup for the whole batch.
    const wallets = [...new Set(events.map((e) => e.payTo).filter((w): w is string => !!w))];
    const watcherRows =
      wallets.length > 0
        ? await db
            .select({ wallet: x402PayeeWatchers.wallet, apiKeyId: x402PayeeWatchers.apiKeyId })
            .from(x402PayeeWatchers)
            .where(inArray(x402PayeeWatchers.wallet, wallets))
        : [];
    const watchersByWallet = new Map<string, string[]>();
    for (const w of watcherRows) {
      const list = watchersByWallet.get(w.wallet) ?? [];
      list.push(w.apiKeyId);
      watchersByWallet.set(w.wallet, list);
    }

    let dispatched = 0;
    for (const event of events) {
      const keys = event.payTo ? watchersByWallet.get(event.payTo) ?? [] : [];
      for (const apiKeyId of keys) {
        await dispatch(apiKeyId, "endpoint.delisted", {
          type: "endpoint.delisted",
          resourceKey: event.resourceKey,
          resourceUrl: event.resourceUrl,
          payTo: event.payTo,
          detectedOn: event.detectedOn,
          lastSeenAt: event.lastSeenAt,
          prevValue: event.prevValue,
          newValue: event.newValue,
          historyUrl: `${SITE_URL}/observatory/e/${event.endpointId}`,
          note: "Factual notice of catalog listing state. Delisting means buyer agents no longer discover this endpoint via the public catalog. This is not an assessment of the operator.",
        });
        dispatched++;
      }
    }

    await db
      .update(x402DelistingEvents)
      .set({ notified: true, notifiedAt: sql`now()` })
      .where(inArray(x402DelistingEvents.id, events.map((e) => e.id)));

    return { processed: events.length, dispatched };
  } catch (error) {
    if (isMissingSchemaError(error)) return { processed: 0, dispatched: 0 };
    throw error;
  }
}
