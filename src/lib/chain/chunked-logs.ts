import type { BlockTag } from "viem";
import type { getPublicClient } from "./client";

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

function isRateLimitError(error: unknown): boolean {
  const err = error as { status?: number; code?: number; cause?: { code?: number } };
  return err?.status === 429 || err?.code === 429 || err?.cause?.code === 429;
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
        `[chunked-logs] giving up on block ${fromBlock}: ${(error as Error)?.constructor?.name} ${(error as Error)?.message?.slice(0, 200)}`,
      );
      throw error;
    }
    console.log(
      `[chunked-logs] bisecting ${fromBlock}-${toBlock} due to: ${(error as Error)?.constructor?.name} ${(error as Error)?.message?.slice(0, 150)}`,
    );

    const mid = fromBlock + span / 2n;
    const left = await fetchRange(client, params, fromBlock, mid);
    const right = await fetchRange(client, params, mid + 1n, toBlock);
    return [...left, ...right];
  }
}

/**
 * eth_getLogs over a wide block range, splitting into chunks and bisecting on RPC range errors.
 */
export async function getLogsChunked(
  client: ChainClient,
  params: ChainGetLogsParams & { fromBlock: bigint },
  chunkSize = getLogsChunkSize(),
): Promise<ChainLog[]> {
  const toBlock = await resolveToBlock(client, params.toBlock);
  const fromBlock = params.fromBlock;
  const { fromBlock: _ignoredFrom, toBlock: _ignoredTo, ...rest } = params;
  void _ignoredFrom;
  void _ignoredTo;

  if (fromBlock > toBlock) return [];

  const results: ChainLog[] = [];
  let start = fromBlock;
  const delayMs = getLogsChunkDelayMs();

  while (start <= toBlock) {
    const end = start + chunkSize - 1n > toBlock ? toBlock : start + chunkSize - 1n;
    const logs = await fetchRange(client, rest, start, end);
    results.push(...logs);
    start = end + 1n;
    if (delayMs > 0 && start <= toBlock) {
      await sleep(delayMs);
    }
  }

  return results;
}
