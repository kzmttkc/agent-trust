import type { BlockTag } from "viem";
import type { getPublicClient } from "./client";
import { mapWithConcurrency } from "@/lib/util/concurrency";

type ChainClient = ReturnType<typeof getPublicClient>;
export type ChainGetLogsParams = Parameters<ChainClient["getLogs"]>[0];
type ChainLog = Awaited<ReturnType<ChainClient["getLogs"]>>[number];

/** Max blocks per eth_getLogs request (Alchemy Base ≈ 2k–10k; default conservative). */
export function getLogsChunkSize(): bigint {
  const raw = process.env.GET_LOGS_CHUNK_BLOCKS;
  if (!raw) return 2_000n;
  try {
    const size = BigInt(raw);
    return size > 0n ? size : 2_000n;
  } catch {
    return 2_000n;
  }
}

/**
 * How many eth_getLogs chunks to fetch in parallel.
 *
 * Wide catch-up ranges (250k blocks / 2k chunk = ~125 sequential round-trips
 * per event) were the owner-indexer's dominant follow-through cost: at
 * ~150-300ms per Neon-region → RPC round-trip that is 20-40s of pure waiting,
 * per event, per run. A small fixed fan-out cuts that near-linearly while
 * staying well inside Alchemy's concurrent-request budget. Kept conservative
 * (default 4) and env-tunable so ops can dial it to 1 (identical to the old
 * strictly-sequential behaviour) if a provider starts rate-limiting — the
 * per-chunk exponential backoff + bisection in fetchRange still absorbs bursts
 * regardless of this value. Do NOT raise this into the tens: the goal is to
 * outpace Base's block production, not to hammer the RPC.
 */
export function getLogsChunkConcurrency(): number {
  const raw = process.env.GET_LOGS_CHUNK_CONCURRENCY;
  if (!raw) return 4;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 4;
  return Math.max(1, Math.min(8, Math.floor(parsed)));
}

function getLogsChunkDelayMs(): number {
  const raw = process.env.GET_LOGS_CHUNK_DELAY_MS;
  if (!raw) return 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveToBlock(
  client: ChainClient,
  toBlock: bigint | BlockTag | undefined,
): Promise<bigint> {
  if (typeof toBlock === "bigint") return toBlock;
  if (toBlock === undefined || toBlock === "latest" || toBlock === "pending") {
    return client.getBlockNumber();
  }
  if (toBlock === "earliest") {
    return 0n;
  }
  if (toBlock === "safe" || toBlock === "finalized") {
    // "safe"/"finalized" refer to the latest safe/finalized block, not
    // genesis — resolve the actual block number via the tag rather than
    // defaulting to 0n (which would silently collapse the range to nothing
    // useful, or worse, to "from genesis").
    const block = await client.getBlock({ blockTag: toBlock });
    return block.number ?? (await client.getBlockNumber());
  }
  throw new Error(`resolveToBlock: unsupported block tag "${String(toBlock)}"`);
}

/** JSON-RPC error code some providers (e.g. Base's public RPC) use for rate limiting. */
const JSON_RPC_RATE_LIMIT_CODE = -32016;

function isRateLimitError(error: unknown): boolean {
  const err = error as {
    status?: number;
    code?: number;
    details?: string;
    message?: string;
    cause?: { code?: number; details?: string };
  };
  if (err?.status === 429 || err?.code === 429 || err?.cause?.code === 429) return true;
  if (err?.code === JSON_RPC_RATE_LIMIT_CODE || err?.cause?.code === JSON_RPC_RATE_LIMIT_CODE) {
    return true;
  }
  const text = `${err?.details ?? ""} ${err?.cause?.details ?? ""} ${err?.message ?? ""}`.toLowerCase();
  return text.includes("rate limit");
}

/**
 * RPC client errors (viem HttpRequestError) embed the full request URL —
 * which includes the provider API key as a path segment — in error.message.
 * Strip it before logging so provider keys never land in Vercel logs.
 */
function redactSecrets(message: string | undefined): string {
  if (!message) return "";
  return message.replace(/https?:\/\/\S+/g, "[redacted-url]");
}

const RATE_LIMIT_MAX_RETRIES = 7;
const RATE_LIMIT_BASE_DELAY_MS = 800;

async function fetchRange(
  client: ChainClient,
  params: Omit<ChainGetLogsParams, "fromBlock" | "toBlock">,
  fromBlock: bigint,
  toBlock: bigint,
  rateLimitRetries = 0,
): Promise<ChainLog[]> {
  if (fromBlock > toBlock) return [];

  try {
    return await client.getLogs({
      ...params,
      fromBlock,
      toBlock,
    } as ChainGetLogsParams);
  } catch (error) {
    if (isRateLimitError(error) && rateLimitRetries < RATE_LIMIT_MAX_RETRIES) {
      console.log(
        `[chunked-logs] rate-limited ${fromBlock}-${toBlock}, retry ${rateLimitRetries + 1}/${RATE_LIMIT_MAX_RETRIES}`,
      );
      await sleep(RATE_LIMIT_BASE_DELAY_MS * 2 ** rateLimitRetries);
      return fetchRange(client, params, fromBlock, toBlock, rateLimitRetries + 1);
    }

    const span = toBlock - fromBlock;
    if (span <= 0n) {
      console.log(
        `[chunked-logs] giving up on block ${fromBlock}: ${(error as Error)?.constructor?.name} ${redactSecrets((error as Error)?.message).slice(0, 200)}`,
      );
      throw error;
    }
    console.log(
      `[chunked-logs] bisecting ${fromBlock}-${toBlock} due to: ${(error as Error)?.constructor?.name} ${redactSecrets((error as Error)?.message).slice(0, 150)}`,
    );

    const mid = fromBlock + span / 2n;
    const left = await fetchRange(client, params, fromBlock, mid);
    const right = await fetchRange(client, params, mid + 1n, toBlock);
    return [...left, ...right];
  }
}

/**
 * eth_getLogs over a wide block range, splitting into chunks and bisecting on RPC range errors.
 *
 * Chunks are fetched with a small bounded fan-out (getLogsChunkConcurrency) to
 * outpace Base's block production during catch-up, but the returned logs are
 * always reassembled in ascending block order so callers that rely on ordering
 * (e.g. transfer replay) see exactly what the old sequential scan produced.
 */
export async function getLogsChunked(
  client: ChainClient,
  params: ChainGetLogsParams & { fromBlock: bigint },
  chunkSize = getLogsChunkSize(),
  concurrency = getLogsChunkConcurrency(),
): Promise<ChainLog[]> {
  const toBlock = await resolveToBlock(client, params.toBlock);
  const fromBlock = params.fromBlock;
  const { fromBlock: _ignoredFrom, toBlock: _ignoredTo, ...rest } = params;
  void _ignoredFrom;
  void _ignoredTo;

  if (fromBlock > toBlock) return [];

  // Pre-compute the chunk ranges up front so fetches can fan out while the
  // per-chunk order in the final array stays deterministic (index-aligned).
  const ranges: { start: bigint; end: bigint }[] = [];
  for (let start = fromBlock; start <= toBlock; start += chunkSize) {
    const end = start + chunkSize - 1n > toBlock ? toBlock : start + chunkSize - 1n;
    ranges.push({ start, end });
  }

  const delayMs = getLogsChunkDelayMs();
  const effectiveConcurrency = Math.max(1, concurrency);

  // Sequential path preserved byte-for-byte for concurrency === 1 (and when a
  // pacing delay is configured, so the delay keeps its "space out RPC calls"
  // meaning rather than becoming a no-op under parallelism).
  if (effectiveConcurrency === 1 || delayMs > 0) {
    const results: ChainLog[] = [];
    for (let i = 0; i < ranges.length; i++) {
      const { start, end } = ranges[i]!;
      const logs = await fetchRange(client, rest, start, end);
      results.push(...logs);
      if (delayMs > 0 && i < ranges.length - 1) {
        await sleep(delayMs);
      }
    }
    return results;
  }

  const perChunk = await mapWithConcurrency(
    ranges,
    effectiveConcurrency,
    ({ start, end }) => fetchRange(client, rest, start, end),
  );

  const results: ChainLog[] = [];
  for (const logs of perChunk) results.push(...logs);
  return results;
}
