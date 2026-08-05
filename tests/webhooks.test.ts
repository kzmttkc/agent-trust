// ============================================================
// Vouch — webhook pure logic: SSRF guard + signature scheme.
//
// Two properties, both security-critical:
//   1. isSafeWebhookUrl is the only thing between "authenticated customer
//      registers a URL" and "our server POSTs to it" — the classic pivot
//      into cloud metadata services and internal hosts.
//   2. The signature is what lets a receiver trust that a delivery came from
//      us and is not a replay. Sign/verify must round-trip, and verify must
//      reject tampering, key mismatch, and stale timestamps.
// ============================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isSafeWebhookUrl,
  isWebhookEvent,
  generateWebhookSecret,
  signWebhookPayload,
  verifyWebhookSignature,
  WEBHOOK_EVENTS,
} from "@/lib/webhooks";

// ---- SSRF guard ------------------------------------------------------------

test("https to a public hostname is allowed", () => {
  assert.equal(isSafeWebhookUrl("https://example.com/hooks/vouch"), true);
  assert.equal(isSafeWebhookUrl("https://api.partner.io:8443/wh?x=1"), true);
});

test("plain http is refused — the payload carries customer signal data", () => {
  assert.equal(isSafeWebhookUrl("http://example.com/hook"), false);
});

test("every classic SSRF pivot is refused", () => {
  const attacks = [
    "https://localhost/hook",
    "https://foo.localhost/hook",
    "https://127.0.0.1/hook",
    "https://0.0.0.0/hook",
    "https://10.1.2.3/hook",
    "https://192.168.1.1/hook",
    "https://172.16.0.1/hook",
    "https://172.31.255.255/hook",
    "https://169.254.169.254/latest/meta-data/", // AWS metadata
    "https://metadata.google.internal/computeMetadata/v1/",
    "https://100.64.0.1/hook", // CGNAT
    "https://224.0.0.1/hook", // multicast
    "https://[::1]/hook",
    "https://intranet/hook", // bare single-label name
    "https://user:pass@example.com/hook", // embedded credentials
    "ftp://example.com/hook",
    "file:///etc/passwd",
    "not a url",
  ];
  for (const url of attacks) {
    assert.equal(isSafeWebhookUrl(url), false, `must refuse ${url}`);
  }
});

test("172.x outside the private /12 stays allowed", () => {
  assert.equal(isSafeWebhookUrl("https://172.15.0.1/hook"), true);
  assert.equal(isSafeWebhookUrl("https://172.32.0.1/hook"), true);
});

// ---- events ----------------------------------------------------------------

test("event registry: known events pass, unknown are refused", () => {
  for (const e of WEBHOOK_EVENTS) assert.equal(isWebhookEvent(e), true);
  assert.equal(isWebhookEvent("score.changed"), false);
  assert.equal(isWebhookEvent(""), false);
});

// ---- signature -------------------------------------------------------------

test("secrets look like whsec_ and are unique", () => {
  const a = generateWebhookSecret();
  const b = generateWebhookSecret();
  assert.ok(a.startsWith("whsec_"));
  assert.ok(a.length > 20);
  assert.notEqual(a, b);
});

test("sign → verify round-trips", () => {
  const secret = "whsec_test";
  const body = JSON.stringify({ type: "outcome.recorded", data: { x: 1 } });
  const now = 1_770_000_000;
  const header = signWebhookPayload(secret, body, now);
  assert.match(header, /^t=\d+,v1=[0-9a-f]{64}$/);
  assert.equal(verifyWebhookSignature(secret, body, header, now), true);
  assert.equal(verifyWebhookSignature(secret, body, header, now + 100), true, "within tolerance");
});

test("verification rejects tampering, wrong keys, and replays", () => {
  const secret = "whsec_test";
  const body = '{"a":1}';
  const now = 1_770_000_000;
  const header = signWebhookPayload(secret, body, now);

  assert.equal(verifyWebhookSignature(secret, '{"a":2}', header, now), false, "tampered body");
  assert.equal(verifyWebhookSignature("whsec_other", body, header, now), false, "wrong secret");
  assert.equal(
    verifyWebhookSignature(secret, body, header, now + 301),
    false,
    "stale beyond tolerance = replay",
  );
  assert.equal(verifyWebhookSignature(secret, body, "t=abc,v1=zz", now), false, "garbage header");
  assert.equal(verifyWebhookSignature(secret, body, "", now), false, "empty header");
  const flipped = header.slice(0, -1) + (header.endsWith("0") ? "1" : "0");
  assert.equal(verifyWebhookSignature(secret, body, flipped, now), false, "bit-flipped sig");
});
