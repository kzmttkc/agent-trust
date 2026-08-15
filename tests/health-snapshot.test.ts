// ============================================================
// health_snapshots — the throttle decision and day-bucketing behind /status
// (B5, 2026-08-15). Both are pure functions, tested without a database; the
// DB-touching wrapper (recordHealthSnapshotIfDue, getStatusHistory) is a thin
// shell around them, exercised in observatory-style .pg tests only if a real
// DB is available (not duplicated here — see the "no unmeasured claim"
// discipline: this file proves the LOGIC, not the wiring).
// ============================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldRecordSnapshot, summarizeByDay } from "@/lib/health/snapshot";

test("no prior snapshot → always record", () => {
  assert.equal(
    shouldRecordSnapshot({ now: new Date(), lastSnapshot: null, currentStatus: "ok" }),
    true,
  );
});

test("status changed since the last row → record even if it was seconds ago", () => {
  const now = new Date("2026-08-15T12:00:00Z");
  const lastSnapshot = { checkedAt: new Date("2026-08-15T11:59:50Z"), status: "ok" };
  assert.equal(shouldRecordSnapshot({ now, lastSnapshot, currentStatus: "degraded" }), true);
});

test("same status, under 5 minutes old → do not record (keeps the table light)", () => {
  const now = new Date("2026-08-15T12:00:00Z");
  const lastSnapshot = { checkedAt: new Date("2026-08-15T11:58:00Z"), status: "ok" };
  assert.equal(shouldRecordSnapshot({ now, lastSnapshot, currentStatus: "ok" }), false);
});

test("same status, exactly 5 minutes old → record (boundary is inclusive)", () => {
  const now = new Date("2026-08-15T12:05:00Z");
  const lastSnapshot = { checkedAt: new Date("2026-08-15T12:00:00Z"), status: "ok" };
  assert.equal(shouldRecordSnapshot({ now, lastSnapshot, currentStatus: "ok" }), true);
});

test("same status, over 5 minutes old → record", () => {
  const now = new Date("2026-08-15T12:10:00Z");
  const lastSnapshot = { checkedAt: new Date("2026-08-15T12:00:00Z"), status: "ok" };
  assert.equal(shouldRecordSnapshot({ now, lastSnapshot, currentStatus: "ok" }), true);
});

test("summarizeByDay buckets snapshots into UTC days and counts each status", () => {
  const rows = [
    { checkedAt: new Date("2026-08-14T23:00:00Z"), status: "ok" },
    { checkedAt: new Date("2026-08-15T00:00:00Z"), status: "ok" },
    { checkedAt: new Date("2026-08-15T06:00:00Z"), status: "degraded" },
    { checkedAt: new Date("2026-08-15T12:00:00Z"), status: "ok" },
  ];
  const summary = summarizeByDay(rows);
  assert.deepEqual(summary, [
    { date: "2026-08-14", total: 1, ok: 1, degraded: 0, error: 0 },
    { date: "2026-08-15", total: 3, ok: 2, degraded: 1, error: 0 },
  ]);
});

test("summarizeByDay on an empty input is an empty array, not a fabricated day", () => {
  assert.deepEqual(summarizeByDay([]), []);
});

test("summarizeByDay never counts a day as 100% ok on zero observations", () => {
  // A day with no rows must not appear at all — showing it with any
  // percentage would assert something never measured.
  const rows = [{ checkedAt: new Date("2026-08-13T12:00:00Z"), status: "ok" }];
  const summary = summarizeByDay(rows);
  assert.equal(summary.length, 1);
  assert.equal(summary.some((d) => d.date === "2026-08-14"), false);
});
