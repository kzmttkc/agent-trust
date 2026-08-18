// ============================================================
// vet402 — signature freshness + monotonic writes (audit 2026-08-15 residual,
// implemented 2026-08-18).
//
// The passport route publishes {message, signature} key-less BY DESIGN
// (third-party verifiability). Without a signed timestamp, any published
// signature is a permanently replayable write credential: replaying an old
// still-valid signature "re-verifies" a stale claim (verifiedAt refreshes)
// or rolls a corrected name/url back to an earlier signed value. The fix:
//
//  1. The canonical message gains an `issued: <exact toISOString()>` line.
//  2. POST verify enforces a freshness window (±10 min) on `issued`.
//  3. The DB write is monotonic IN ONE STATEMENT — the update only fires
//     when the stored issued_at is NULL (pre-migration row) or strictly
//     older. Replaying an older signature is a 409, never a rollback.
//     (Check-then-write in two statements would reopen exactly the TOCTOU
//     class this repo has been burned by before.)
//
// Message-builder tests run everywhere; route+DB tests skip without
// TEST_DATABASE_URL (same convention as the observatory suites).
// ============================================================
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { verifyMessage } from "viem";
import { payeeMessage, agentPassportMessage, isValidIssuedAt } from "@/lib/verify-message";

const ISSUED = "2026-08-18T12:00:00.000Z";

// ---- Message-builder layer (no DB) ----

test("isValidIssuedAt accepts only the exact toISOString shape", () => {
  assert.equal(isValidIssuedAt(new Date().toISOString()), true);
  assert.equal(isValidIssuedAt("2026-08-18T12:00:00Z"), false); // missing millis
  assert.equal(isValidIssuedAt("2026-08-18T12:00:00.000Z\nurl: evil"), false);
  assert.equal(isValidIssuedAt("not-a-date"), false);
  assert.equal(isValidIssuedAt(""), false);
});

test("payeeMessage binds issued into the signed bytes", () => {
  const withIssued = payeeMessage("0x0000000000000000000000000000000000000001", "Acme", undefined, ISSUED);
  assert.ok(withIssued.includes(`issued: ${ISSUED}`));
  // Different issued → different signed bytes.
  const other = payeeMessage(
    "0x0000000000000000000000000000000000000001",
    "Acme",
    undefined,
    "2026-08-18T12:00:01.000Z",
  );
  assert.notEqual(withIssued, other);
});

test("payeeMessage without issued keeps the legacy shape (read-path reconstruction)", () => {
  const legacy = payeeMessage("0x0000000000000000000000000000000000000001", "Acme");
  assert.ok(!legacy.includes("issued:"), "legacy messages must stay byte-identical for old rows");
});

test("payeeMessage refuses a malformed issued (line-injection backstop)", () => {
  assert.throws(() =>
    payeeMessage("0x0000000000000000000000000000000000000001", "Acme", undefined, "2026-01-01T00:00:00.000Z\nwallet: 0xEVIL"),
  );
  assert.throws(() =>
    payeeMessage("0x0000000000000000000000000000000000000001", "Acme", undefined, "garbage"),
  );
});

test("tampering with issued breaks signature verification end-to-end", async () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const message = payeeMessage(account.address, "Acme", "https://acme.example", ISSUED);
  const signature = await account.signMessage({ message });
  assert.equal(await verifyMessage({ address: account.address, message, signature }), true);

  const tampered = payeeMessage(account.address, "Acme", "https://acme.example", "2026-08-18T12:00:01.000Z");
  assert.equal(await verifyMessage({ address: account.address, message: tampered, signature }), false);
});

test("agentPassportMessage binds issued the same way (symmetric twin)", async () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const message = agentPassportMessage(7n, account.address, "Agent", "https://agent.example", ISSUED);
  assert.ok(message.includes(`issued: ${ISSUED}`));
  const signature = await account.signMessage({ message });
  assert.equal(await verifyMessage({ address: account.address, message, signature }), true);
  // Older-issued reconstruction of the SAME (name,url) yields a different
  // message the signature no longer matches — the passport read-path relies on
  // trying candidate shapes until one verifies.
  const older = agentPassportMessage(7n, account.address, "Agent", "https://agent.example", "2026-08-18T11:00:00.000Z");
  assert.equal(await verifyMessage({ address: account.address, message: older, signature }), false);
});

test("a legacy (no-issued, no-url) signature still verifies against the base shape", async () => {
  // Rows written before either binding must stay third-party-verifiable: the
  // passport read-path reconstructs candidate shapes newest-first and returns
  // whichever verifies. Here the base shape is the one that matches.
  const account = privateKeyToAccount(generatePrivateKey());
  const legacy = agentPassportMessage(9n, account.address, "Legacy Agent");
  const signature = await account.signMessage({ message: legacy });
  assert.equal(await verifyMessage({ address: account.address, message: legacy, signature }), true);
  // The issued/url-bound candidates would NOT verify against this signature,
  // so the read-path must fall through to the base shape (asserted here by the
  // base shape verifying while a bound shape does not).
  const bound = agentPassportMessage(9n, account.address, "Legacy Agent", "https://x.example", ISSUED);
  assert.equal(await verifyMessage({ address: account.address, message: bound, signature }), false);
});

// ---- Route + DB layer ----

const TEST_DB = process.env.TEST_DATABASE_URL;

if (!TEST_DB) {
  test("issued monotonic route (skipped: TEST_DATABASE_URL not set)", { skip: true }, () => {});
} else {
  process.env.DATABASE_URL = TEST_DB;

  after(async () => {
    const { getDb } = await import("@/lib/db/client");
    const db = getDb() as unknown as { $client?: { end?: () => Promise<void> } } | null;
    await db?.$client?.end?.();
  });

  test("payee verify enforces freshness and monotonic issued writes", async (t) => {
    const { getDb } = await import("@/lib/db/client");
    const schema = await import("@/lib/db/schema");
    const { sql, eq } = await import("drizzle-orm");
    const { POST, GET } = await import("@/app/api/v1/payees/verify/route");

    const db = getDb()!;
    await db.execute(sql`TRUNCATE verified_payees`);

    const account = privateKeyToAccount(generatePrivateKey());
    const wallet = account.address.toLowerCase();

    // This suite deliberately writes the SAME wallet several times to test
    // monotonicity, which trips the per-wallet (4/min) and per-IP (8/min) POST
    // throttles. Those are exercised in payee-verify.test.ts; here they are
    // noise, so clear the bucket table before each POST.
    const post = async (body: unknown) => {
      await db.execute(sql`TRUNCATE ip_rate_limits`);
      return POST(
        new NextRequest("http://localhost/api/v1/payees/verify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
    };

    const sign = async (name: string, url: string | undefined, issued: string) => {
      const message = payeeMessage(wallet, name, url, issued);
      return account.signMessage({ message });
    };

    await t.test("GET preview mints and returns the issued value it embedded", async () => {
      const res = await GET(
        new NextRequest(
          `http://localhost/api/v1/payees/verify?wallet=${wallet}&name=Acme`,
        ),
      );
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(isValidIssuedAt(body.issued), "preview must return the issued it minted");
      assert.ok(body.message.includes(`issued: ${body.issued}`));
    });

    await t.test("a fresh signed registration is accepted and lands with issued_at", async () => {
      const issued = new Date().toISOString();
      const res = await post({
        wallet,
        name: "Acme",
        url: "https://acme.example",
        issued,
        signature: await sign("Acme", "https://acme.example", issued),
      });
      assert.equal(res.status, 200);
      const [row] = await db
        .select()
        .from(schema.verifiedPayees)
        .where(eq(schema.verifiedPayees.wallet, wallet));
      assert.ok(row.issuedAt, "issued_at must be persisted");
      assert.equal(row.url, "https://acme.example");
    });

    await t.test("replaying an OLDER still-valid signature cannot roll back (409)", async () => {
      // The attacker holds a genuinely signed but older message (e.g. scraped
      // before a correction). Freshness window would reject a stale wall-clock
      // issued, so simulate the in-window case: an older-but-recent issued.
      const older = new Date(Date.now() - 5 * 60_000).toISOString();
      const olderSig = await sign("Old Name", undefined, older);

      const res = await post({ wallet, name: "Old Name", issued: older, signature: olderSig });
      assert.equal(res.status, 409);
      const body = await res.json();
      assert.equal(body.error, "stale_signature");

      // The current registration is untouched.
      const [row] = await db
        .select()
        .from(schema.verifiedPayees)
        .where(eq(schema.verifiedPayees.wallet, wallet));
      assert.equal(row.name, "Acme");
      assert.equal(row.url, "https://acme.example");
    });

    await t.test("a NEWER signature updates (the legitimate correction path)", async () => {
      const newer = new Date().toISOString();
      const res = await post({
        wallet,
        name: "Acme Renamed",
        issued: newer,
        signature: await sign("Acme Renamed", undefined, newer),
      });
      assert.equal(res.status, 200);
      const [row] = await db
        .select()
        .from(schema.verifiedPayees)
        .where(eq(schema.verifiedPayees.wallet, wallet));
      assert.equal(row.name, "Acme Renamed");
    });

    await t.test("an issued outside the freshness window is rejected before any write", async () => {
      const stale = new Date(Date.now() - 60 * 60_000).toISOString();
      const res = await post({
        wallet,
        name: "Way Old",
        issued: stale,
        signature: await sign("Way Old", undefined, stale),
      });
      assert.equal(res.status, 400);
      assert.equal((await res.json()).error, "signature_expired");

      const future = new Date(Date.now() + 60 * 60_000).toISOString();
      const res2 = await post({
        wallet,
        name: "From The Future",
        issued: future,
        signature: await sign("From The Future", undefined, future),
      });
      assert.equal(res2.status, 400, "a far-future issued must not lock the row");
    });

    await t.test("a request without issued is rejected (legacy POSTs closed)", async () => {
      const res = await post({
        wallet,
        name: "No Issued",
        signature: await sign("No Issued", undefined, new Date().toISOString()),
      });
      assert.equal(res.status, 400);
    });

    await t.test(
      "before the migration (issued_at column absent) a fresh POST still succeeds (graceful fallback)",
      async () => {
        // Simulate a code deploy that landed before the Neon migration.
        await db.execute(sql`TRUNCATE verified_payees`);
        await db.execute(sql`ALTER TABLE verified_payees DROP COLUMN IF EXISTS issued_at`);
        try {
          const issued = new Date().toISOString();
          const res = await post({
            wallet,
            name: "Pre Migration",
            issued,
            signature: await sign("Pre Migration", undefined, issued),
          });
          // The write degrades to the legacy path — a 200, not a 503 that would
          // break a live feature while the column is missing.
          assert.equal(res.status, 200);
          const [row] = await db
            .select({ name: schema.verifiedPayees.name })
            .from(schema.verifiedPayees)
            .where(eq(schema.verifiedPayees.wallet, wallet));
          assert.equal(row.name, "Pre Migration");
        } finally {
          // Restore the column for any later run against this shared DB.
          await db.execute(sql`ALTER TABLE verified_payees ADD COLUMN IF NOT EXISTS issued_at timestamptz`);
        }
      },
    );
  });
}
