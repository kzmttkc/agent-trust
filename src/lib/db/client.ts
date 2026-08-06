import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { drizzle as drizzlePostgres, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type AppDatabase = NeonHttpDatabase<typeof schema> | PostgresJsDatabase<typeof schema>;

let db: AppDatabase | null = null;

function isLocalDatabaseUrl(url: string): boolean {
  return /localhost|127\.0\.0\.1/.test(url);
}

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

let testDbOverride: AppDatabase | null = null;

/**
 * TEST-ONLY seam. Lets a test inject an in-memory fake so the owner-scoping in
 * the data layer (removeWatch / deleteWebhook filter by apiKeyId) can be
 * exercised without a live Postgres. Never called on any production path.
 */
export function __setDbForTests(fake: unknown): void {
  testDbOverride = (fake as AppDatabase) ?? null;
}

export function getDb(): AppDatabase | null {
  if (testDbOverride) return testDbOverride;
  if (!process.env.DATABASE_URL) return null;

  if (!db) {
    const url = process.env.DATABASE_URL;
    if (isLocalDatabaseUrl(url)) {
      const client = postgres(url, { max: 10 });
      db = drizzlePostgres(client, { schema });
    } else {
      const sql = neon(url);
      db = drizzleNeon(sql, { schema });
    }
  }

  return db;
}
