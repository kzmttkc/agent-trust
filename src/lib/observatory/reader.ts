// ============================================================
// vet402 Observatory L0 — public-page readers (design §5, §7).
//
// Read-only aggregation for /observatory pages. Two rules:
//
//  1. Missing-schema tolerant (all-company convention): deploying this code
//     before the migration must render an honest empty state, not a 500.
//
//  2. What these readers surface is FACTS with evidence attached — verdict
//     strings from the closed vocabulary, counts with their denominators.
//     The published verdict applies publishedVerdict() so a single fail
//     renders as `unverified` (legal multiple-measurement condition).
// ============================================================
import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { isMissingSchemaError } from "@/lib/db/pg-errors";
import {
  x402CatalogSnapshots,
  x402DelistingEvents,
  x402Endpoints,
  x402L0Probes,
} from "@/lib/db/schema";
import { publishedVerdict, MIN_CONSECUTIVE_FAILS_TO_PUBLISH } from "./l0-probe";

export type ObservatoryListRow = {
  id: string;
  resourceKey: string;
  network: string | null;
  method: string | null;
  status: string;
  publishedVerdict: "pass" | "fail" | "unverified";
  lastProbedAt: Date | null;
  qualityCalls30d: number | null;
};

export type ObservatoryOverview = {
  rows: ObservatoryListRow[];
  page: number;
  pageSize: number;
  totalEndpoints: number;
  /** Snapshot health of the latest ingest — shown so the reader can judge the data's completeness. */
  latestSnapshot: {
    snapshotDate: string;
    totalCount: number;
    fetchedCount: number;
  } | null;
};

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getObservatoryOverview(
  options: { page?: number; pageSize?: number } = {},
): Promise<ObservatoryOverview> {
  const pageSize = Math.min(Math.max(options.pageSize ?? 100, 1), 200);
  const page = Math.max(options.page ?? 1, 1);
  const db = getDb();
  const empty: ObservatoryOverview = {
    rows: [],
    page,
    pageSize,
    totalEndpoints: 0,
    latestSnapshot: null,
  };
  if (!db) return empty;

  try {
    const [countRow] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(x402Endpoints);
    const totalEndpoints = countRow?.n ?? 0;

    // Recent-verdicts lateral: only for the rows on this page, newest first,
    // just enough (2) for the publication gate.
    const raw = await db.execute(sql`
      SELECT e.id, e.resource_key, e.network, e.method, e.status,
             e.quality_calls_30d,
             lp.verdicts AS verdicts,
             lp.last_probed_at AS last_probed_at
      FROM x402_endpoints e
      LEFT JOIN LATERAL (
        SELECT array_agg(v.verdict) AS verdicts, max(v.probed_at) AS last_probed_at
        FROM (
          SELECT verdict, probed_at FROM x402_l0_probes p
          WHERE p.endpoint_id = e.id
          ORDER BY probed_at DESC
          LIMIT ${MIN_CONSECUTIVE_FAILS_TO_PUBLISH}
        ) v
      ) lp ON true
      ORDER BY e.quality_calls_30d DESC NULLS LAST, e.resource_key ASC
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    `);
    const list = (Array.isArray(raw) ? raw : (raw as { rows?: unknown[] }).rows ?? []) as Record<
      string,
      unknown
    >[];

    const rows: ObservatoryListRow[] = list.map((r) => ({
      id: String(r.id),
      resourceKey: String(r.resource_key),
      network: (r.network as string | null) ?? null,
      method: (r.method as string | null) ?? null,
      status: String(r.status),
      publishedVerdict: publishedVerdict(((r.verdicts as string[] | null) ?? []) as string[]),
      lastProbedAt: r.last_probed_at ? new Date(String(r.last_probed_at)) : null,
      qualityCalls30d:
        r.quality_calls_30d === null || r.quality_calls_30d === undefined
          ? null
          : Number(r.quality_calls_30d),
    }));

    const [snap] = await db
      .select({
        snapshotDate: x402CatalogSnapshots.snapshotDate,
        totalCount: x402CatalogSnapshots.totalCount,
        fetchedCount: x402CatalogSnapshots.fetchedCount,
      })
      .from(x402CatalogSnapshots)
      .orderBy(desc(x402CatalogSnapshots.snapshotDate))
      .limit(1);

    return { rows, page, pageSize, totalEndpoints, latestSnapshot: snap ?? null };
  } catch (error) {
    if (isMissingSchemaError(error)) return empty;
    throw error;
  }
}

export type EndpointDetail = {
  endpoint: {
    id: string;
    resourceKey: string;
    resourceUrl: string;
    source: string;
    method: string | null;
    network: string | null;
    payTo: string | null;
    priceAmount: string | null;
    priceAsset: string | null;
    description: string | null;
    status: string;
    firstSeenAt: Date | null;
    lastSeenAt: Date | null;
    delistedAt: Date | null;
    qualityCalls30d: number | null;
    qualityPayers30d: number | null;
  };
  publishedVerdict: "pass" | "fail" | "unverified";
  probes: {
    probedAt: Date | null;
    method: string;
    verdict: string;
    httpStatus: number | null;
    latencyMs: number | null;
    failReason: string | null;
  }[];
  events: {
    eventType: string;
    detectedOn: string;
    prevValue: unknown;
    newValue: unknown;
    createdAt: Date | null;
  }[];
} | null;

export async function getEndpointDetail(id: string): Promise<EndpointDetail> {
  if (!uuidRe.test(id)) return null;
  const db = getDb();
  if (!db) return null;

  try {
    const [e] = await db.select().from(x402Endpoints).where(eq(x402Endpoints.id, id)).limit(1);
    if (!e) return null;

    const probes = await db
      .select({
        probedAt: x402L0Probes.probedAt,
        method: x402L0Probes.method,
        verdict: x402L0Probes.verdict,
        httpStatus: x402L0Probes.httpStatus,
        latencyMs: x402L0Probes.latencyMs,
        failReason: x402L0Probes.failReason,
      })
      .from(x402L0Probes)
      .where(eq(x402L0Probes.endpointId, id))
      .orderBy(desc(x402L0Probes.probedAt))
      .limit(30);

    const events = await db
      .select({
        eventType: x402DelistingEvents.eventType,
        detectedOn: x402DelistingEvents.detectedOn,
        prevValue: x402DelistingEvents.prevValue,
        newValue: x402DelistingEvents.newValue,
        createdAt: x402DelistingEvents.createdAt,
      })
      .from(x402DelistingEvents)
      .where(eq(x402DelistingEvents.endpointId, id))
      .orderBy(desc(x402DelistingEvents.createdAt))
      .limit(30);

    return {
      endpoint: {
        id: e.id,
        resourceKey: e.resourceKey,
        resourceUrl: e.resourceUrl,
        source: e.source,
        method: e.method,
        network: e.network,
        payTo: e.payTo,
        priceAmount: e.priceAmount,
        priceAsset: e.priceAsset,
        description: e.description,
        status: e.status,
        firstSeenAt: e.firstSeenAt,
        lastSeenAt: e.lastSeenAt,
        delistedAt: e.delistedAt,
        qualityCalls30d: e.qualityCalls30d,
        qualityPayers30d: e.qualityPayers30d,
      },
      publishedVerdict: publishedVerdict(probes.map((p) => p.verdict)),
      probes,
      events,
    };
  } catch (error) {
    if (isMissingSchemaError(error)) return null;
    throw error;
  }
}

export type ObservatoryStats = {
  totalEndpoints: number;
  activeEndpoints: number;
  delistedEndpoints: number;
  /** Endpoints whose PUBLISHED verdict is fail (≥2 consecutive fails). */
  publishedFail: number;
  publishedPass: number;
  /** No declared method / no probe yet / gate not met. */
  publishedUnverified: number;
  methodUndeclared: number;
  eventCounts: { delisted: number; relisted: number; settleDrop: number };
  latestSnapshot: { snapshotDate: string; totalCount: number; fetchedCount: number } | null;
};

export async function getObservatoryStats(): Promise<ObservatoryStats> {
  const empty: ObservatoryStats = {
    totalEndpoints: 0,
    activeEndpoints: 0,
    delistedEndpoints: 0,
    publishedFail: 0,
    publishedPass: 0,
    publishedUnverified: 0,
    methodUndeclared: 0,
    eventCounts: { delisted: 0, relisted: 0, settleDrop: 0 },
    latestSnapshot: null,
  };
  const db = getDb();
  if (!db) return empty;

  try {
    // Publication-gated verdict per endpoint, computed in SQL with the same
    // rule as publishedVerdict(): latest pass → pass; latest fail counts its
    // streak against the gate; everything else → unverified.
    const raw = await db.execute(sql`
      WITH latest AS (
        SELECT e.id, e.status, e.method,
               lp.verdicts AS verdicts
        FROM x402_endpoints e
        LEFT JOIN LATERAL (
          SELECT array_agg(v.verdict) AS verdicts
          FROM (
            SELECT verdict FROM x402_l0_probes p
            WHERE p.endpoint_id = e.id
            ORDER BY probed_at DESC
            LIMIT ${MIN_CONSECUTIVE_FAILS_TO_PUBLISH}
          ) v
        ) lp ON true
      )
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE status = 'active')::int AS active,
        count(*) FILTER (WHERE status = 'delisted')::int AS delisted,
        count(*) FILTER (WHERE method IS NULL)::int AS method_undeclared,
        count(*) FILTER (WHERE verdicts[1] = 'pass')::int AS published_pass,
        count(*) FILTER (
          WHERE verdicts[1] = 'fail'
            AND cardinality(verdicts) >= ${MIN_CONSECUTIVE_FAILS_TO_PUBLISH}
            AND NOT EXISTS (
              SELECT 1 FROM unnest(verdicts) AS u(v) WHERE u.v <> 'fail'
            )
        )::int AS published_fail
      FROM latest
    `);
    const list = (Array.isArray(raw) ? raw : (raw as { rows?: unknown[] }).rows ?? []) as Record<
      string,
      unknown
    >[];
    const agg = list[0] ?? {};
    const total = Number(agg.total ?? 0);
    const publishedPass = Number(agg.published_pass ?? 0);
    const publishedFail = Number(agg.published_fail ?? 0);

    const evRaw = await db.execute(sql`
      SELECT event_type, count(*)::int AS n
      FROM x402_delisting_events GROUP BY event_type
    `);
    const evList = (Array.isArray(evRaw) ? evRaw : (evRaw as { rows?: unknown[] }).rows ?? []) as {
      event_type: string;
      n: number;
    }[];
    const ev = Object.fromEntries(evList.map((r) => [r.event_type, Number(r.n)]));

    const [snap] = await db
      .select({
        snapshotDate: x402CatalogSnapshots.snapshotDate,
        totalCount: x402CatalogSnapshots.totalCount,
        fetchedCount: x402CatalogSnapshots.fetchedCount,
      })
      .from(x402CatalogSnapshots)
      .orderBy(desc(x402CatalogSnapshots.snapshotDate))
      .limit(1);

    return {
      totalEndpoints: total,
      activeEndpoints: Number(agg.active ?? 0),
      delistedEndpoints: Number(agg.delisted ?? 0),
      publishedFail,
      publishedPass,
      publishedUnverified: Math.max(0, total - publishedPass - publishedFail),
      methodUndeclared: Number(agg.method_undeclared ?? 0),
      eventCounts: {
        delisted: ev.delisted ?? 0,
        relisted: ev.relisted ?? 0,
        settleDrop: ev.settle_drop ?? 0,
      },
      latestSnapshot: snap ?? null,
    };
  } catch (error) {
    if (isMissingSchemaError(error)) return empty;
    throw error;
  }
}
