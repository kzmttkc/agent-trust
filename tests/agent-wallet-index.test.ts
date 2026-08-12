// ============================================================
// Vouch — WalletSet 索引の畳み込み規則（2026-08-13）。
//
// WHY. wallet→agent の逆引きはチェーン上に存在しない。だから元の実装は
// WalletSet ログを毎回 FROM_BLOCK から走査していた（1ウォレットあたり約4,100
// 往復）。索引に移すにあたって唯一の危険は「同じ agentId のウォレットが
// 貼り替えられたとき、古い方を残すこと」——古い束縛を残すと、他人のウォレットに
// エージェントの実績が付く。ブロック順の畳み込みをここで直接テストする。
// ============================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Address } from "viem";
import { latestWalletPerAgent } from "@/lib/indexer/agent-wallet-indexer";

const A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Address;
const B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Address;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;

function log(agentId: bigint | undefined, wallet: Address | undefined, blockNumber: bigint, logIndex: number) {
  return { args: { agentId, wallet }, blockNumber, logIndex };
}

test("同じ agentId は最後の WalletSet が勝つ（貼り替え後の束縛だけを残す）", () => {
  const pairs = latestWalletPerAgent([
    log(1n, A, 100n, 0),
    log(1n, B, 200n, 0),
  ]);
  assert.deepEqual(pairs, [{ agentId: 1n, wallet: B }]);
});

test("同一ブロック内は logIndex の大きい方が後（順序を取り違えない）", () => {
  const pairs = latestWalletPerAgent([
    log(1n, B, 100n, 5),
    log(1n, A, 100n, 2),
  ]);
  assert.deepEqual(pairs, [{ agentId: 1n, wallet: B }]);
});

test("agentId ごとに1件ずつ返す", () => {
  const pairs = latestWalletPerAgent([log(1n, A, 100n, 0), log(2n, B, 101n, 0)]);
  assert.equal(pairs.length, 2);
  assert.deepEqual(
    pairs.map((p) => p.agentId).sort((x, y) => Number(x - y)),
    [1n, 2n],
  );
});

test("agentId 欠落・不正アドレス・ゼロアドレスは索引に入れない", () => {
  const pairs = latestWalletPerAgent([
    log(undefined, A, 100n, 0),
    log(2n, undefined, 100n, 1),
    log(3n, "0xnope" as Address, 100n, 2),
    log(4n, ZERO, 100n, 3),
  ]);
  assert.deepEqual(pairs, []);
});
