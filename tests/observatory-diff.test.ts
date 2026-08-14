// ============================================================
// vet402 Observatory L0 — daily catalog diff (design §3 step 3).
//
// The dangerous failure mode is a FALSE delisting: telling a seller "you
// vanished from Bazaar" when the truth is our fetch had a gap. So the diff
// is fail-closed on evidence quality: an incomplete fetch day produces NO
// delisted events at all. Relisting and settle-drop are positive/derived
// evidence and survive an incomplete day.
// ============================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeCatalogDiff,
  SETTLE_DROP_MIN_PREV_CALLS,
  SETTLE_DROP_RATIO,
} from "@/lib/observatory/catalog-diff";

function diffInput(overrides: Partial<Parameters<typeof computeCatalogDiff>[0]>) {
  return {
    prevKeys: new Set<string>(),
    currentKeys: new Set<string>(),
    currentComplete: true,
    knownEndpoints: new Map(),
    currentQuality: new Map(),
    ...overrides,
  };
}

test("first run (no previous snapshot) produces no events", () => {
  const events = computeCatalogDiff(
    diffInput({ prevKeys: null, currentKeys: new Set(["a.example/x"]) }),
  );
  assert.deepEqual(events, []);
});

test("an endpoint present yesterday and absent today is delisted — only on a complete fetch", () => {
  const base = {
    prevKeys: new Set(["gone.example/api", "stays.example/api"]),
    currentKeys: new Set(["stays.example/api"]),
    knownEndpoints: new Map([
      ["gone.example/api", { status: "active", qualityCalls30d: 5 }],
      ["stays.example/api", { status: "active", qualityCalls30d: 9 }],
    ]),
  };

  const complete = computeCatalogDiff(diffInput({ ...base, currentComplete: true }));
  assert.equal(complete.length, 1);
  assert.equal(complete[0].eventType, "delisted");
  assert.equal(complete[0].resourceKey, "gone.example/api");

  const incomplete = computeCatalogDiff(diffInput({ ...base, currentComplete: false }));
  assert.deepEqual(
    incomplete.filter((e) => e.eventType === "delisted"),
    [],
    "a fetch gap must never read as a delisting",
  );
});

test("an endpoint already marked delisted is NOT re-reported while still absent", () => {
  const events = computeCatalogDiff(
    diffInput({
      prevKeys: new Set(["gone.example/api"]),
      currentKeys: new Set(),
      knownEndpoints: new Map([
        ["gone.example/api", { status: "delisted", qualityCalls30d: null }],
      ]),
    }),
  );
  assert.deepEqual(events, []);
});

test("a delisted endpoint that reappears is relisted — even on an incomplete fetch", () => {
  const events = computeCatalogDiff(
    diffInput({
      prevKeys: new Set(),
      currentKeys: new Set(["back.example/api"]),
      currentComplete: false, // presence is positive evidence; incompleteness doesn't taint it
      knownEndpoints: new Map([
        ["back.example/api", { status: "delisted", qualityCalls30d: null }],
      ]),
    }),
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].eventType, "relisted");
});

test("settle_drop fires only above the floor and beyond the ratio", () => {
  const key = "svc.example/api";
  const mk = (prev: number | null, cur: number | null) =>
    computeCatalogDiff(
      diffInput({
        prevKeys: new Set([key]),
        currentKeys: new Set([key]),
        knownEndpoints: new Map([[key, { status: "active", qualityCalls30d: prev }]]),
        currentQuality: new Map([[key, cur]]),
      }),
    );

  // 732 → 120 is an 84% drop over the 100-call floor → event with evidence
  const drop = mk(732, 120);
  assert.equal(drop.length, 1);
  assert.equal(drop[0].eventType, "settle_drop");
  assert.deepEqual(drop[0].prevValue, { calls30d: 732 });
  assert.deepEqual(drop[0].newValue, { calls30d: 120 });

  // below the floor: 50 → 5 is noise, not signal
  assert.deepEqual(mk(50, 5), []);
  // above floor but within ratio: 200 → 100 (50% drop < 70%) → no event
  assert.deepEqual(mk(200, 100), []);
  // missing data on either side → no event (never infer a drop from absence)
  assert.deepEqual(mk(null, 10), []);
  assert.deepEqual(mk(500, null), []);
});

test("thresholds are what the design says", () => {
  assert.equal(SETTLE_DROP_MIN_PREV_CALLS, 100);
  assert.equal(SETTLE_DROP_RATIO, 0.7);
});
