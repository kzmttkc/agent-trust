// ============================================================
// レジストリ配線（C4）。金の経路に触るフックなので分岐を全て固定:
//  - フラグOFF（既定）→ disabled・鍵もagent解決も触らない
//  - Solana/不正payTo → not_evm
//  - 鍵なし → key_missing（フラグONでも書かない）
// 実書込は registry-writes.test.ts が担う——ここは配線の門番だけ。
// ============================================================
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { publishL1OutcomeToRegistry } from "@/lib/chain/registry-hook";

afterEach(() => {
  delete process.env.REGISTRY_WRITES_ENABLED;
  delete process.env.REGISTRY_OPERATOR_PRIVATE_KEY;
});

const BASE_INPUT = {
  endpointId: "5f0c9c5e-2c3a-4b1e-9a4d-8f6b2e1c7d0a",
  payTo: "0x52e29e0d2aa49bfbfc548c0a9f2196f4aa51f3ea",
  settled: true,
};

test("既定はOFF → disabled", async () => {
  const out = await publishL1OutcomeToRegistry(BASE_INPUT);
  assert.deepEqual(out, { status: "disabled" });
});

test("Solana payTo → not_evm（フラグONでも）", async () => {
  process.env.REGISTRY_WRITES_ENABLED = "true";
  const out = await publishL1OutcomeToRegistry({
    ...BASE_INPUT,
    payTo: "GqSs5L9aPWGJwyRQe35YKQaWMDPh3R1dMqfSEPhSgkM",
  });
  assert.deepEqual(out, { status: "not_evm" });
});

test("鍵なし → key_missing（agent解決・RPCに触る前に帰る）", async () => {
  process.env.REGISTRY_WRITES_ENABLED = "true";
  const out = await publishL1OutcomeToRegistry(BASE_INPUT);
  assert.deepEqual(out, { status: "key_missing" });
});
