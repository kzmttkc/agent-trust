import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorizeApiRequest, withRateLimitHeaders } from "@/lib/api/guard";
import { isValidAddress } from "@/lib/chain/client";
import { getTrustEventById, recordPartnerOutcome } from "@/lib/db/outcome-writer";
import { logServerError } from "@/lib/util/log";

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

const bodySchema = z.object({
  outcomeType: z.enum(["confirmed_fraud", "confirmed_legitimate", "chargeback_dispute", "other"]),
  relatedWallet: z.string().min(1).optional(),
  notes: z.string().max(1000).optional(),
  evidenceUrl: z
    .string()
    .url()
    .max(2048)
    .refine(isHttpUrl, { message: "evidenceUrl must use http or https" })
    .optional(),
});

type RouteContext = { params: Promise<{ trustEventId: string }> };

/**
 * POST /api/v1/events/{trustEventId}/outcome
 *
 * Partner-reported result label for a past trust_events verdict (fraud
 * confirmation, chargeback, etc). Idempotent per (trustEventId, outcomeType,
 * source) — reporting the same outcomeType again from the same key returns
 * the existing row rather than erroring.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await authorizeApiRequest(request, 1);
  if (!auth.ok) return auth.error;

  const { trustEventId } = await context.params;
  if (!UUID_RE.test(trustEventId)) {
    return NextResponse.json({ error: "invalid_trust_event_id" }, { status: 400 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { outcomeType, relatedWallet, notes, evidenceUrl } = parsed.data;

  if (relatedWallet && !isValidAddress(relatedWallet)) {
    return NextResponse.json({ error: "invalid_wallet_address" }, { status: 400 });
  }

  let trustEvent: Awaited<ReturnType<typeof getTrustEventById>>;
  try {
    trustEvent = await getTrustEventById(trustEventId);
  } catch (error) {
    logServerError("outcome_report_lookup", error);
    return NextResponse.json({ error: "outcome_ingest_unavailable" }, { status: 503 });
  }

  if (!trustEvent) {
    return NextResponse.json({ error: "trust_event_not_found" }, { status: 404 });
  }

  const resolvedWallet = relatedWallet ?? trustEvent.wallet ?? null;
  const now = new Date();
  const windowMinutes = Math.max(
    0,
    Math.floor((now.getTime() - trustEvent.createdAt.getTime()) / 60_000),
  );

  try {
    const result = await recordPartnerOutcome({
      trustEventId,
      outcomeType,
      relatedWallet: resolvedWallet,
      windowMinutes,
      apiKeyId: auth.ctx.apiKeyId,
      evidence: {
        notes: notes ?? null,
        evidenceUrl: evidenceUrl ?? null,
      },
    });

    if (!result) {
      return NextResponse.json({ error: "outcome_ingest_unavailable" }, { status: 503 });
    }

    return withRateLimitHeaders(
      NextResponse.json(
        {
          ok: true,
          created: result.created,
          id: result.id,
          trustEventId,
          outcomeType,
        },
        { status: result.created ? 201 : 200 },
      ),
      auth.ctx.rateLimit,
    );
  } catch (error) {
    logServerError("outcome_report_ingest", error);
    return NextResponse.json({ error: "outcome_ingest_unavailable" }, { status: 503 });
  }
}
