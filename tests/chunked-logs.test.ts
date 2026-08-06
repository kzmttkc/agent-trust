// ============================================================
// Vouch — chunked eth_getLogs (owner/funder/outcome indexer core).
//
// The follow-through throughput of every indexer rides on this function:
// a wide catch-up range is split into fixed-size chunks and fetched with a
// small bounded fan-out. The properties that must hold no matter how the
// fetches interleave:
//   1. every block in [from,to] is covered exactly once (no gaps, no dup scans);
//   2. the returned logs are in ascending block order — transfer replay in
//      owner-indexer depends on it (fail-closed: a mis-ordered burn/mint pair
//      would flip ownership the wrong way);
//   3. the fan-out never exceeds the configured bound (don't hammer the RPC);
//   4. transient rate-limits and over-wide-range errors degrade (retry /
//      bisect), never silently drop a chunk.
// ============================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getLogsChunked,
  getLogsChunkConcurrency,
} from "@/lib/chain/chunked-logs";

type Range = { start: bigint; end: bigint };
type Log = { blockNumber: bigint; id: string };

// Minimal fake that records every getLogs call and returns one log per range
// tagged with its start block, so tests can assert coverage and ordering.
function makeClient(opts?: {
  onRange?: (r: Range) => Log[] | Error;
  trackConcurrency?: boolean;
}) {
  const calls: Range[] = [];
  let inFlight = 0;
  let peak = 0;
  const client = {
    async getLogs(params: { fromBlock: bigint; toBlock: bigint }) {
      const range = { start: params.fromBlock, end: params.toBlock };
      calls.push(range);
      inFlight++;
      if (inFlight > peak) peak = inFlight;
      try {
        // Yield so overlapping fetches actually interleave under parallelism.
        await new Promise((r) => setTimeout(r, 1));
        const out = opts?.onRange?.(range);
        if (out instanceof Error) throw out;
        return (out ?? [{ blockNumber: range.start, id: `${range.start}-${range.end}` }]) as unknown[];
      } finally {
        inFlight--;
      }
    },
  };
  return {
    client: client as unknown as Parameters<typeof getLogsChunked>[0],
    calls,
    peak: () => peak,
  };
}

test("covers the whole range in ascending, gap-free chunks", async () => {
  const { client, calls } = makeClient();
  const logs = (await getLogsChunked(
    client,
    { fromBlock: 100n, toBlock: 349n },
    100n,
    4,
  )) as unknown as Log[];

  // 100-199, 200-299, 300-349 — no gaps, last chunk clamped to toBlock.
  const ordered = [...calls].sort((a, b) => Number(a.start - b.start));
  assert.deepEqual(
    ordered.map((c) => [c.start, c.end]),
    [
      [100n, 199n],
      [200n, 299n],
      [300n, 349n],
    ],
  );
  // Result is index-aligned to ascending ranges regardless of fetch interleave.
  assert.deepEqual(
    logs.map((l) => l.blockNumber),
    [100n, 200n, 300n],
  );
});

test("single block range is one inclusive chunk", async () => {
  const { client, calls } = makeClient();
  const logs = (await getLogsChunked(client, { fromBlock: 5n, toBlock: 5n }, 100n, 4)) as unknown as Log[];
  assert.deepEqual(calls, [{ start: 5n, end: 5n }]);
  assert.equal(logs.length, 1);
});

test("empty when fromBlock > toBlock (no calls)", async () => {
  const { client, calls } = makeClient();
  const logs = await getLogsChunked(client, { fromBlock: 10n, toBlock: 9n }, 100n, 4);
  assert.equal(logs.length, 0);
  assert.equal(calls.length, 0);
});

test("fan-out never exceeds the configured concurrency", async () => {
  const { client, peak } = makeClient({ trackConcurrency: true });
  // 20 chunks, cap 3 → peak in-flight must stay <= 3.
  await getLogsChunked(client, { fromBlock: 0n, toBlock: 199n }, 10n, 3);
  assert.ok(peak() <= 3, `peak in-flight ${peak()} exceeded cap 3`);
  assert.ok(peak() >= 2, `expected real parallelism, saw peak ${peak()}`);
});

test("concurrency 1 stays strictly sequential", async () => {
  const { client, peak } = makeClient({ trackConcurrency: true });
  await getLogsChunked(client, { fromBlock: 0n, toBlock: 99n }, 10n, 1);
  assert.equal(peak(), 1);
});

test("a configured pacing delay forces sequential fetching", async () => {
  process.env.GET_LOGS_CHUNK_DELAY_MS = "1";
  try {
    const { client, peak } = makeClient({ trackConcurrency: true });
    // concurrency 4 requested, but delay pins it to one-at-a-time.
    await getLogsChunked(client, { fromBlock: 0n, toBlock: 99n }, 10n, 4);
    assert.equal(peak(), 1);
  } finally {
    delete process.env.GET_LOGS_CHUNK_DELAY_MS;
  }
});

test("rate-limited chunk is retried, not dropped", async () => {
  let failedOnce = false;
  const { client, calls } = makeClient({
    onRange: (r) => {
      if (r.start === 10n && !failedOnce) {
        failedOnce = true;
        return Object.assign(new Error("rate limit exceeded"), { code: -32016 });
      }
      return [{ blockNumber: r.start, id: `${r.start}` }];
    },
  });
  const logs = (await getLogsChunked(client, { fromBlock: 0n, toBlock: 29n }, 10n, 2)) as unknown as Log[];
  // 3 chunks + 1 retry of the middle chunk = 4 calls; all three blocks present.
  assert.equal(calls.length, 4);
  assert.deepEqual(
    logs.map((l) => l.blockNumber),
    [0n, 10n, 20n],
  );
});

test("over-wide-range error bisects until it succeeds", async () => {
  // Reject any single getLogs wider than 4 blocks (non-rate-limit error) so
  // the 10-block chunk must bisect down.
  const { client } = makeClient({
    onRange: (r) => {
      if (r.end - r.start > 4n) return new Error("query returned more than 10000 results");
      return [{ blockNumber: r.start, id: `${r.start}-${r.end}` }];
    },
  });
  const logs = (await getLogsChunked(client, { fromBlock: 0n, toBlock: 9n }, 10n, 2)) as unknown as Log[];
  // The chunk bisected into sub-ranges that each satisfy the <=4 span limit.
  assert.ok(logs.length >= 1);
  assert.ok(logs.every((l) => typeof l.blockNumber === "bigint"));
});

test("concurrency env clamps to a sane bounded range", () => {
  const prev = process.env.GET_LOGS_CHUNK_CONCURRENCY;
  try {
    delete process.env.GET_LOGS_CHUNK_CONCURRENCY;
    assert.equal(getLogsChunkConcurrency(), 4); // conservative default

    process.env.GET_LOGS_CHUNK_CONCURRENCY = "1";
    assert.equal(getLogsChunkConcurrency(), 1);

    process.env.GET_LOGS_CHUNK_CONCURRENCY = "100";
    assert.equal(getLogsChunkConcurrency(), 8); // capped — never hammer the RPC

    process.env.GET_LOGS_CHUNK_CONCURRENCY = "0";
    assert.equal(getLogsChunkConcurrency(), 1); // floored to sequential

    process.env.GET_LOGS_CHUNK_CONCURRENCY = "not-a-number";
    assert.equal(getLogsChunkConcurrency(), 4);
  } finally {
    if (prev === undefined) delete process.env.GET_LOGS_CHUNK_CONCURRENCY;
    else process.env.GET_LOGS_CHUNK_CONCURRENCY = prev;
  }
});
