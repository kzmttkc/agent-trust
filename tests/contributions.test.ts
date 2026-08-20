// ============================================================
// 許可不要L0コントリビューション v0（Phase 3.3）。
// 固定する性質:
//  - 既定OFF: フラグ無しでは 403 相当の拒否・署名検証すら走らない
//  - 署名は実検証（viemの実鍵で署名した正のケースが通り、改竄が落ちる）
//  - 保存されるのは正規化メッセージの原文ごと（後から検証可能）
//  - 公開 verdict へ混ぜない、はAPIの note とモジュール設計で明示
// ============================================================
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import { __setDbForTests } from "@/lib/db/client";
import {
  contributionMessage,
  submitContribution,
} from "@/lib/observatory/contributions";

const ENDPOINT_ID = "5f0c9c5e-2c3a-4b1e-9a4d-8f6b2e1c7d0a";
const ACCOUNT = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);

function insertCapturingDb(rows: unknown[]) {
  return {
    insert() {
      return {
        values(v: unknown) {
          rows.push(v);
          return { returning: async () => [{ id: "c1", ...(v as object) }] };
        },
      };
    },
  };
}

afterEach(() => {
  __setDbForTests(null);
  delete process.env.CONTRIBUTIONS_ENABLED;
});

test("既定OFF → contributions_disabled", async () => {
  const result = await submitContribution({
    endpointId: ENDPOINT_ID,
    verdict: "pass",
    httpStatus: 402,
    latencyMs: 120,
    address: ACCOUNT.address,
    signature: "0xdead",
  });
  assert.deepEqual(result, { ok: false, reason: "contributions_disabled" });
});

test("実鍵で署名した正のケースが通り、原文メッセージごと保存される", async () => {
  process.env.CONTRIBUTIONS_ENABLED = "true";
  const rows: { message?: string; submitter?: string }[] = [];
  __setDbForTests(insertCapturingDb(rows));
  const message = contributionMessage({
    endpointId: ENDPOINT_ID,
    verdict: "pass",
    httpStatus: 402,
    latencyMs: 120,
  });
  const signature = await ACCOUNT.signMessage({ message });
  const result = await submitContribution({
    endpointId: ENDPOINT_ID,
    verdict: "pass",
    httpStatus: 402,
    latencyMs: 120,
    address: ACCOUNT.address,
    signature,
  });
  assert.equal(result.ok, true);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].message, message);
  assert.equal(rows[0].submitter, ACCOUNT.address.toLowerCase());
});

test("内容を1箇所でも変えた署名は invalid_signature・保存されない", async () => {
  process.env.CONTRIBUTIONS_ENABLED = "true";
  const rows: unknown[] = [];
  __setDbForTests(insertCapturingDb(rows));
  const signature = await ACCOUNT.signMessage({
    message: contributionMessage({
      endpointId: ENDPOINT_ID,
      verdict: "pass",
      httpStatus: 402,
      latencyMs: 120,
    }),
  });
  const tampered = await submitContribution({
    endpointId: ENDPOINT_ID,
    verdict: "fail", // 署名時と異なる
    httpStatus: 402,
    latencyMs: 120,
    address: ACCOUNT.address,
    signature,
  });
  assert.deepEqual(tampered, { ok: false, reason: "invalid_signature" });
  assert.equal(rows.length, 0);
});

test("不正入力（UUIDでない・未知verdict・変なアドレス）は署名検証前に拒否", async () => {
  process.env.CONTRIBUTIONS_ENABLED = "true";
  __setDbForTests(insertCapturingDb([]));
  for (const bad of [
    { endpointId: "../../etc", verdict: "pass", address: ACCOUNT.address },
    { endpointId: ENDPOINT_ID, verdict: "great", address: ACCOUNT.address },
    { endpointId: ENDPOINT_ID, verdict: "pass", address: "not-an-address" },
  ]) {
    const result = await submitContribution({
      ...bad,
      httpStatus: null,
      latencyMs: null,
      signature: "0xdead",
    });
    assert.deepEqual(result, { ok: false, reason: "invalid_input" });
  }
});
