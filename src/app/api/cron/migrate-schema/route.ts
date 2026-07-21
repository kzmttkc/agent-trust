import { NextRequest, NextResponse } from "next/server";
import { authorizeCron } from "@/lib/cron/auth";
import { getDb } from "@/lib/db/client";
import { sql } from "drizzle-orm";

/**
 * TEMPORARY one-shot migration endpoint (2026-07-22).
 *
 * funder_index_skips and verdict_outcomes exist in src/lib/db/schema.ts but
 * were never applied to the production DB (drizzle-kit push was never run
 * against it), so index-funders/detect-outcomes silently degrade to no-op.
 * This creates both tables + their indexes idempotently (IF NOT EXISTS),
 * matching schema.ts exactly so a future `db:push` sees no drift.
 *
 * DELETE THIS ROUTE after the one-time run confirms both tables exist.
 */
export async function GET(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const db = getDb();
  if (!db) {
    return NextResponse.json({ error: "no_database" }, { status: 503 });
  }

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "funder_index_skips" (
      "wallet" text PRIMARY KEY,
      "attempts" integer NOT NULL DEFAULT 1,
      "last_attempt_at" timestamptz DEFAULT now(),
      "next_retry_at" timestamptz NOT NULL
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "verdict_outcomes" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "trust_event_id" uuid NOT NULL,
      "outcome_type" text NOT NULL,
      "related_wallet" text,
      "detected_at" timestamptz NOT NULL DEFAULT now(),
      "window_minutes" integer NOT NULL,
      "source" text NOT NULL DEFAULT 'auto',
      "api_key_id" uuid,
      "evidence" jsonb,
      "created_at" timestamptz DEFAULT now()
    )
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "verdict_outcomes_trust_event_idx"
      ON "verdict_outcomes" ("trust_event_id")
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "verdict_outcomes_type_detected_idx"
      ON "verdict_outcomes" ("outcome_type", "detected_at")
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "verdict_outcomes_unique"
      ON "verdict_outcomes" ("trust_event_id", "outcome_type", "source")
  `);

  const check = await db.execute(sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('funder_index_skips', 'verdict_outcomes')
    ORDER BY table_name
  `);

  return NextResponse.json({ ok: true, tables: check });
}
