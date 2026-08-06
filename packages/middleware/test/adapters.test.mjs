// Adapter tests: Express, Next, Hono. Each verifies the block/allow/warn
// branch and the fail-closed default, using structural mocks (no framework
// installed). Run with `npm test` after `npm run build`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createExpressGate } from "../dist/express.js";
import { withVouchGate, createNextGate } from "../dist/next.js";
import { createHonoGate } from "../dist/hono.js";

const ADDR = "0x2222222222222222222222222222222222222222";
const CFG = { apiUrl: "https://vouch.test/api/v1", apiKey: "vk_test" };

function scoreFetch(body, { ok = true, status = 200 } = {}) {
  return async () => ({ ok, status, json: async () => body });
}
const allowFetch = scoreFetch({ trustScore: 80, recommendation: "ALLOW" });
const blockFetch = scoreFetch({ trustScore: 10, recommendation: "BLOCK" });
const downFetch = async () => {
  throw new Error("down");
};

// ---- Express -------------------------------------------------------------
function mockRes() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
  };
}

test("express: ALLOW calls next and attaches the decision", async () => {
  const mw = createExpressGate({ ...CFG, fetch: allowFetch, getAddress: (r) => r.payer });
  const req = { payer: ADDR };
  const res = mockRes();
  let nexted = false;
  await mw(req, res, () => {
    nexted = true;
  });
  assert.equal(nexted, true);
  assert.equal(res.statusCode, null);
  assert.equal(req.vouchTrust.action, "allow");
});

test("express: BLOCK responds 403 and does not call next", async () => {
  const mw = createExpressGate({ ...CFG, fetch: blockFetch, getAddress: (r) => r.payer });
  const req = { payer: ADDR };
  const res = mockRes();
  let nexted = false;
  await mw(req, res, () => {
    nexted = true;
  });
  assert.equal(nexted, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, "trust_blocked");
});

test("express: fail-closed on lookup error → 403", async () => {
  const mw = createExpressGate({ ...CFG, fetch: downFetch, getAddress: (r) => r.payer });
  const req = { payer: ADDR };
  const res = mockRes();
  let nexted = false;
  await mw(req, res, () => {
    nexted = true;
  });
  assert.equal(nexted, false);
  assert.equal(res.statusCode, 403);
});

test("express: missing address → 400", async () => {
  const mw = createExpressGate({ ...CFG, fetch: allowFetch, getAddress: () => undefined });
  const res = mockRes();
  await mw({}, res, () => {});
  assert.equal(res.statusCode, 400);
});

test("express: onWarn fires on a WARN verdict and still calls next", async () => {
  const mw = createExpressGate({
    ...CFG,
    fetch: scoreFetch({ trustScore: 50, recommendation: "WARN" }),
    getAddress: (r) => r.payer,
    onWarn: (d, r) => {
      r.warned = d.action;
    },
  });
  const req = { payer: ADDR };
  const res = mockRes();
  let nexted = false;
  await mw(req, res, () => {
    nexted = true;
  });
  assert.equal(nexted, true);
  assert.equal(req.warned, "warn");
});

// ---- Next ----------------------------------------------------------------
test("next: withVouchGate blocks with 403 before the handler runs", async () => {
  let handlerRan = false;
  const POST = withVouchGate(
    { ...CFG, fetch: blockFetch, getAddress: (req) => new URL(req.url).searchParams.get("payer") ?? undefined },
    async () => {
      handlerRan = true;
      return Response.json({ ok: true });
    },
  );
  const res = await POST(new Request(`https://x.test/api/paid?payer=${ADDR}`));
  assert.equal(res.status, 403);
  assert.equal(handlerRan, false);
});

test("next: withVouchGate runs the handler on ALLOW and passes the decision", async () => {
  const POST = withVouchGate(
    { ...CFG, fetch: allowFetch, getAddress: (req) => new URL(req.url).searchParams.get("payer") ?? undefined },
    async (_req, trust) => Response.json({ ok: true, action: trust.action }),
  );
  const res = await POST(new Request(`https://x.test/api/paid?payer=${ADDR}`));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, action: "allow" });
});

test("next: createNextGate.check returns a blocking response object on BLOCK", async () => {
  const gate = createNextGate({ ...CFG, fetch: blockFetch });
  const { decision, response } = await gate.check(ADDR);
  assert.equal(decision.action, "block");
  assert.equal(response.status, 403);
});

// ---- Hono ----------------------------------------------------------------
function mockCtx(vars = {}) {
  return {
    vars,
    set(k, v) {
      this.vars[k] = v;
    },
    get(k) {
      return this.vars[k];
    },
    json(body, status = 200) {
      return Response.json(body, { status });
    },
  };
}

test("hono: ALLOW calls next and stashes the decision", async () => {
  const mw = createHonoGate({ ...CFG, fetch: allowFetch, getAddress: (c) => c.get("payer") });
  const c = mockCtx({ payer: ADDR });
  let nexted = false;
  const out = await mw(c, async () => {
    nexted = true;
  });
  assert.equal(nexted, true);
  assert.equal(out, undefined);
  assert.equal(c.get("vouchTrust").action, "allow");
});

test("hono: BLOCK returns a 403 Response and does not call next", async () => {
  const mw = createHonoGate({ ...CFG, fetch: blockFetch, getAddress: (c) => c.get("payer") });
  const c = mockCtx({ payer: ADDR });
  let nexted = false;
  const out = await mw(c, async () => {
    nexted = true;
  });
  assert.equal(nexted, false);
  assert.equal(out.status, 403);
});

test("hono: fail-closed on lookup error → 403 Response", async () => {
  const mw = createHonoGate({ ...CFG, fetch: downFetch, getAddress: (c) => c.get("payer") });
  const c = mockCtx({ payer: ADDR });
  const out = await mw(c, async () => {});
  assert.equal(out.status, 403);
});
