import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { consumeIpRateLimit } from "@/lib/api/ip-rate-limit";
import { isValidAddress } from "@/lib/chain/client";
import {
  MAX_CSV_ENTRIES,
  addCustomerListEntry,
  importCustomerListEntries,
  listCustomerEntries,
} from "@/lib/db/customer-lists";
import { authorizeDashboardRequest } from "@/lib/dashboard/auth";
import { invalidateScoreCacheForListChange } from "@/lib/scoring/cache-invalidation";
import { parseListCsv } from "@/lib/util/csv";

const LIST_MUTATION_LIMIT = 30;
const LIST_MUTATION_WINDOW_MS = 60 * 60 * 1000;

async function enforceListMutationLimit(apiKeyId: string): Promise<NextResponse | null> {
  const limited = await consumeIpRateLimit(
    `list_mut:${apiKeyId}`,
    LIST_MUTATION_LIMIT,
    LIST_MUTATION_WINDOW_MS,
  );
  if (!limited.allowed) {
    return NextResponse.json(
      { error: "rate_limit_exceeded", retryAfter: limited.retryAfter },
      { status: 429 },
    );
  }
  return null;
}

export async function GET(request: NextRequest) {
  const auth = await authorizeDashboardRequest(request);
  if (!auth.ok) return auth.error;

  const entries = await listCustomerEntries(auth.ctx.apiKeyId);
  return NextResponse.json({ entries });
}

const addSchema = z.object({
  wallet: z.string(),
  listType: z.enum(["whitelist", "blacklist"]),
});

export async function POST(request: NextRequest) {
  const auth = await authorizeDashboardRequest(request);
  if (!auth.ok) return auth.error;

  const limited = await enforceListMutationLimit(auth.ctx.apiKeyId);
  if (limited) return limited;

  const body = await request.json().catch(() => null);
  const parsed = addSchema.safeParse(body);
  if (!parsed.success || !isValidAddress(parsed.data?.wallet ?? "")) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  try {
    const entry = await addCustomerListEntry({
      apiKeyId: auth.ctx.apiKeyId,
      wallet: parsed.data.wallet,
      listType: parsed.data.listType,
    });

    await invalidateScoreCacheForListChange(parsed.data.wallet);
    return NextResponse.json({ entry }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "DATABASE_URL is not configured") {
      return NextResponse.json({ error: "database_unavailable" }, { status: 503 });
    }
    return NextResponse.json({ error: "duplicate_list_entry" }, { status: 409 });
  }
}

const importSchema = z.object({
  csv: z.string().min(1).max(200_000),
});

export async function PUT(request: NextRequest) {
  const auth = await authorizeDashboardRequest(request);
  if (!auth.ok) return auth.error;

  const limited = await enforceListMutationLimit(auth.ctx.apiKeyId);
  if (limited) return limited;

  const body = await request.json().catch(() => null);
  const parsed = importSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const entries = parseListCsv(parsed.data.csv).filter((entry) => isValidAddress(entry.wallet));
  if (entries.length === 0) {
    return NextResponse.json({ error: "no_valid_entries" }, { status: 400 });
  }

  if (entries.length > MAX_CSV_ENTRIES) {
    return NextResponse.json({ error: "csv_too_large", limit: MAX_CSV_ENTRIES }, { status: 400 });
  }

  try {
    const result = await importCustomerListEntries({
      apiKeyId: auth.ctx.apiKeyId,
      entries,
    });

    for (const entry of entries) {
      await invalidateScoreCacheForListChange(entry.wallet);
    }

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === "csv_too_large") {
      return NextResponse.json({ error: "csv_too_large", limit: MAX_CSV_ENTRIES }, { status: 400 });
    }
    return NextResponse.json({ error: "import_failed" }, { status: 400 });
  }
}
