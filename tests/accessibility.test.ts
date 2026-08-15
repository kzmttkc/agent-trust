// ============================================================
// Automated accessibility regression net (B2, 2026-08-15).
//
// WHY: this codebase's a11y record so far is entirely manual — a series of
// "persona audits" (blind/screen-reader, keyboard, 320px) found and fixed
// real defects (missing table row headers, unreachable skip links, dead
// focus after SPA navigation, contrast ratios below AA). Every one of those
// fixes is documented in the code with the exact defect found. None of it is
// re-checked automatically: the next unrelated change can silently
// reintroduce any of them and nothing in `npm test` would notice.
//
// WHAT THIS CHECKS: axe-core against the actual rendered HTML of each listed
// path, loaded into jsdom. This catches structural defects — missing labels,
// wrong roles, broken landmark structure, heading order, form labeling,
// image alt text, ARIA misuse — which is most of what regresses in practice
// (a removed label, a div that lost its role, a heading level skipped when a
// section was reordered).
//
// WHAT THIS DOES NOT CHECK: color contrast. jsdom has no real layout or CSS
// cascade engine, so axe's color-contrast rule against it produces false
// results either direction — it is excluded from the ruleset below, not
// silently included and ignored. Contrast stays the manual audit's job (see
// the "AA不合格" comments throughout globals.css for its actual track
// record). A real-browser (Playwright) pass would close this gap; not set up
// here — tracked as a known limitation, not silently claimed as covered.
//
// REQUIRES a running server: set A11Y_BASE_URL, or start `vet402-dev`
// locally (defaults to http://localhost:4800, the .claude/launch.json port).
// Same fail-safe shape as the TEST_DATABASE_URL-gated tests: unreachable
// means every test in this file SKIPS, not fails, so `npm test` stays green
// with no server running (e.g. in an environment with no browser preview).
//
// IMPLEMENTATION NOTE (two RED reproductions kept as comments, not just in
// history, because both are easy to reintroduce by "simplifying" this file):
//  1. axe-core's CJS build detects window/document ONCE, at module-evaluation
//     time. Importing it before any jsdom globals exist locks it into "no
//     DOM" mode permanently — setting globals afterward does not undo that.
//     Fixed by deferring the import until after the first jsdom window is on
//     `globalThis` (loadAxeCore() below).
//  2. axe-core also does not tolerate the ambient window being swapped for a
//     DIFFERENT jsdom realm between calls (a fresh `new JSDOM()` per page
//     throws "axe.run arguments are invalid" on the second and later pages —
//     reproduced against the real package). Fixed by creating exactly ONE
//     JSDOM window for the whole file and loading each page's HTML into it
//     with document.open()/write()/close(), the same mechanism a real
//     browser tab uses to navigate without becoming a new realm.
// ============================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const BASE_URL = process.env.A11Y_BASE_URL ?? "http://localhost:4800";

// Paths chosen to cover: the memo (heaviest single page), the two working
// no-key demos (payee, observatory register + detail), a data-table-heavy
// report (leaderboard — the page the row-header fix in [A6]/R2 targeted),
// the signup form, and one dashboard-shell page (login, the one dashboard
// route reachable with no session).
const PATHS = [
  "/",
  "/payee",
  "/observatory",
  "/observatory/methodology",
  "/leaderboard",
  "/faq",
  "/signup",
  "/dashboard/login",
];

type AxeCoreModule = typeof import("axe-core");
let axeCorePromise: Promise<AxeCoreModule> | null = null;
let sharedDom: JSDOM | null = null;

function ensureDom(): JSDOM {
  if (sharedDom) return sharedDom;
  sharedDom = new JSDOM("<!doctype html><html><head></head><body></body></html>", {
    url: `${BASE_URL}/`,
    pretendToBeVisual: true,
  });
  (globalThis as unknown as { window: unknown }).window = sharedDom.window;
  (globalThis as unknown as { document: unknown }).document = sharedDom.window.document;
  return sharedDom;
}

function loadAxeCore(): Promise<AxeCoreModule> {
  ensureDom();
  if (!axeCorePromise) axeCorePromise = import("axe-core").then((m) => m.default ?? m);
  return axeCorePromise;
}

test.after(() => {
  if (!sharedDom) return;
  sharedDom.window.close();
  sharedDom = null;
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { document?: unknown }).document;
});

let serverReachable: boolean | null = null;

async function checkServer(): Promise<boolean> {
  if (serverReachable !== null) return serverReachable;
  try {
    const res = await fetch(BASE_URL, { signal: AbortSignal.timeout(2000) });
    serverReachable = res.ok || res.status < 500;
  } catch {
    serverReachable = false;
  }
  return serverReachable;
}

// Rules axe cannot evaluate meaningfully without a real rendering engine.
// color-contrast: needs real computed styles (see file header).
// Others in this list need real layout (bounding boxes, scroll containers).
const JSDOM_UNSUPPORTED_RULES = ["color-contrast", "scrollable-region-focusable"];

for (const path of PATHS) {
  test(`${path} has no structural accessibility violations`, async (t) => {
    if (!(await checkServer())) {
      t.skip(`${BASE_URL} is not reachable — start the vet402-dev server to run this check`);
      return;
    }

    const res = await fetch(`${BASE_URL}${path}`);
    if (!res.ok) {
      t.skip(`${path} returned ${res.status} — cannot audit a page that did not render`);
      return;
    }
    const html = await res.text();

    const doc = ensureDom().window.document;
    doc.open();
    doc.write(html);
    doc.close();

    const axeCore = await loadAxeCore();
    const results = await axeCore.run(doc as unknown as Element, {
      rules: Object.fromEntries(JSDOM_UNSUPPORTED_RULES.map((id) => [id, { enabled: false }])),
    });

    const relevant = results.violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious" || v.impact === "moderate",
    );
    const summary = relevant
      .map((v) => `${v.id} (${v.impact}, ${v.nodes.length} node(s)): ${v.help} — ${v.helpUrl}`)
      .join("\n");
    assert.equal(relevant.length, 0, `${path} has axe violations:\n${summary}`);
  });
}
