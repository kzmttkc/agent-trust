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

async function resolveToBlock(
  client: ChainClient,
  toBlock: bigint | BlockTag | undefined,
): Promise<bigint> {
  if (typeof toBlock === "bigint") return toBlock;
  if (toBlock === undefined || toBlock === "latest" || toBlock === "pending") {
    return client.getBlockNumber();
  }
  if (toBlock === "earliest" || toBlock === "safe" || toBlock === "finalized") {
    return 0n;
  }
  return client.getBlockNumber();
}

async function fetchRange(
  client: ChainClient,
  params: Omit<ChainGetLogsParams, "fromBlock" | "toBlock">,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<ChainLog[]> {
  if (fromBlock > toBlock) return [];

  try {
    return await client.getLogs({
      ...params,
      fromBlock,
      toBlock,
    } as ChainGetLogsParams);
  } catch (error) {
    const span = toBlock - fromBlock;
    if (span <= 0n) throw error;

    const mid = fromBlock + span / 2n;
    const [left, right] = await Promise.all([
      fetchRange(client, params, fromBlock, mid),
      fetchRange(client, params, mid + 1n, toBlock),
    ]);
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

  while (start <= toBlock) {
    const end = start + chunkSize - 1n > toBlock ? toBlock : start + chunkSize - 1n;
    const logs = await fetchRange(client, rest, start, end);
    results.push(...logs);
    start = end + 1n;
  }

  return results;
}
