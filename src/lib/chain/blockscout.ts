import { DEFAULT_CHAIN_ID, chainById } from "./chains";
import type { Address } from "viem";

type BlockscoutTx = {
  hash: string;
  blockNumber: string;
  timeStamp: string;
  from: string;
  to: string;
  value: string;
};

type BlockscoutTokenTx = BlockscoutTx & {
  contractAddress: string;
  tokenDecimal: string;
  tokenSymbol: string;
};

type BlockscoutResponse<T> = {
  status: string;
  message: string;
  result: T;
};

export class BlockscoutUnavailableError extends Error {
  /** True when the same request has a real chance of succeeding if repeated. */
  readonly retryable: boolean;

  constructor(message = "blockscout_unavailable", cause?: unknown, retryable = false) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = "BlockscoutUnavailableError";
    this.retryable = retryable;
  }
}

/**
 * Blockscout's public API rate-limits aggressively, and it is the sole source
 * of wallet age / tx-count / funder data. Measured 2026-08-12 against
 * base.blockscout.com: a burst of the shape one score produces starts drawing
 * `HTTP 429 "Too many requests"` after ~15 requests, and once tripped it keeps
 * returning 429 for a while. That is exactly the failure that surfaced as the
 * showcase agent scoring 48/BLOCK with sybilRisk:"high" and walletAgeDays 0 —
 * a rate-limited fetch throws, the engine flags wallet_metrics_unavailable,
 * and the verdict is (correctly, but needlessly) failed closed.
 *
 * Probing the API from outside with a few spaced-out requests reports it
 * perfectly healthy, which is why upstream looked fine while Vouch was cut off:
 * the load pattern, not the endpoint, is what fails.
 *
 * So transient answers get a bounded retry before they are allowed to become a
 * verdict. This does NOT soften the verdict: when the data genuinely cannot be
 * fetched the error still propagates and the caller still fails closed. It only
 * stops a recoverable blip from being treated as an answer.
 */
const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 250;

function isRateLimitMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes("too many requests") || lower.includes("rate limit");
}

function retryDelayMs(attempt: number): number {
  // Exponential with jitter, so concurrent callers that tripped the same limit
  // do not march back in lockstep and trip it again.
  return RETRY_BASE_MS * 2 ** (attempt - 1) + Math.floor(Math.random() * RETRY_BASE_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getBlockscoutBaseUrl(chainId?: number): string {
  // Explicit env override wins (ops escape hatch), then the per-chain
  // registry. Unknown chain ids fall back to Base — callers that care pass a
  // registered id; this keeps the historical default byte-identical.
  if (process.env.BLOCKSCOUT_API_URL && (chainId === undefined || chainId === DEFAULT_CHAIN_ID)) {
    return process.env.BLOCKSCOUT_API_URL;
  }
  const chain = chainById(chainId ?? DEFAULT_CHAIN_ID);
  return chain?.blockscoutApi ?? "https://base.blockscout.com/api";
}

function isEmptyResultMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("no transactions") ||
    lower.includes("no records") ||
    lower.includes("no token") ||
    lower.includes("not found")
  );
}

async function blockscoutGetOnce<T>(
  params: Record<string, string>,
  chainId?: number,
): Promise<T | null> {
  const url = new URL(getBlockscoutBaseUrl(chainId));
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const apiKey = process.env.BLOCKSCOUT_API_KEY;
  if (apiKey) {
    url.searchParams.set("apikey", apiKey);
  }

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      next: { revalidate: 0 },
    });
  } catch (error) {
    // Connection reset / DNS / socket hang-up: worth one more try.
    throw new BlockscoutUnavailableError("blockscout_network_error", error, true);
  }

  if (!response.ok) {
    // 429 = rate limited, 5xx = their side is unwell. Both pass with time.
    // Any other 4xx is our request being wrong; repeating it changes nothing.
    const retryable = response.status === 429 || response.status >= 500;
    throw new BlockscoutUnavailableError(`blockscout_http_${response.status}`, undefined, retryable);
  }

  let data: BlockscoutResponse<T>;
  try {
    data = (await response.json()) as BlockscoutResponse<T>;
  } catch (error) {
    throw new BlockscoutUnavailableError("blockscout_invalid_json", error);
  }

  if (data.status === "1" && data.result) {
    return data.result;
  }

  if (isEmptyResultMessage(data.message ?? "")) {
    return null;
  }

  // Ambiguous status=0 without an empty-result message → treat as outage/rate-limit.
  // Blockscout also serves its rate-limit refusal this way (HTTP 200 with
  // status:"0" and a "Too many requests" message), so read the message too.
  const message = data.message ?? "";
  throw new BlockscoutUnavailableError(
    `blockscout_api_error:${message || data.status || "unknown"}`,
    undefined,
    isRateLimitMessage(message),
  );
}

async function blockscoutGet<T>(params: Record<string, string>, chainId?: number): Promise<T | null> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await blockscoutGetOnce<T>(params, chainId);
    } catch (error) {
      lastError = error;
      const retryable = error instanceof BlockscoutUnavailableError && error.retryable;
      if (!retryable || attempt === MAX_ATTEMPTS) break;
      await sleep(retryDelayMs(attempt));
    }
  }

  // Retries exhausted, or the failure was never going to pass. Either way the
  // caller must still fail closed — a failed read is never an empty result.
  throw lastError;
}

export async function fetchWalletTransactions(
  address: Address,
  options: { sort?: "asc" | "desc"; offset?: number; page?: number; chainId?: number } = {},
): Promise<BlockscoutTx[]> {
  const result = await blockscoutGet<BlockscoutTx[] | string>({
    module: "account",
    action: "txlist",
    address,
    startblock: "0",
    endblock: "99999999",
    page: String(options.page ?? 1),
    offset: String(options.offset ?? 100),
    sort: options.sort ?? "asc",
  }, options.chainId);

  if (!result || typeof result === "string") return [];
  return result;
}

/**
 * ERC20 transfer history for a wallet, via Blockscout's Etherscan-compatible
 * `account/tokentx` endpoint (same unauthenticated API family as `txlist`).
 * When `contractAddress` is given, results are filtered to that token both
 * server-side (Blockscout honors the param) and client-side (defensive, in
 * case a proxy or older instance ignores it). `value` is in the token's own
 * smallest unit (e.g. 6 decimals for USDC), not wei.
 */
export async function fetchTokenTransfers(
  address: Address,
  options: {
    contractAddress?: Address;
    sort?: "asc" | "desc";
    offset?: number;
    page?: number;
  } = {},
): Promise<BlockscoutTokenTx[]> {
  const params: Record<string, string> = {
    module: "account",
    action: "tokentx",
    address,
    startblock: "0",
    endblock: "99999999",
    page: String(options.page ?? 1),
    offset: String(options.offset ?? 100),
    sort: options.sort ?? "asc",
  };
  if (options.contractAddress) {
    params.contractaddress = options.contractAddress;
  }

  const result = await blockscoutGet<BlockscoutTokenTx[] | string>(params);

  if (!result || typeof result === "string") return [];
  if (!options.contractAddress) return result;

  const contractLower = options.contractAddress.toLowerCase();
  return result.filter((tx) => tx.contractAddress?.toLowerCase() === contractLower);
}

/**
 * Current ERC20 token balance (in the token's smallest unit), via
 * Blockscout's Etherscan-compatible `account/tokenbalance` endpoint. Live
 * snapshot, same caveat as fetchWalletBalance below.
 */
export async function fetchTokenBalance(
  address: Address,
  contractAddress: Address,
): Promise<bigint | null> {
  const result = await blockscoutGet<string>({
    module: "account",
    action: "tokenbalance",
    contractaddress: contractAddress,
    address,
  });

  if (result === null) return null;
  try {
    return BigInt(result);
  } catch {
    return null;
  }
}

/**
 * Current native-token balance (wei), via Blockscout's Etherscan-compatible
 * `account/balance` endpoint. This is a live snapshot, not a historical
 * balance at a given block — used by the outcome detector as a same-call
 * proxy for "how much is left" when sizing an outflow.
 */
export async function fetchWalletBalance(address: Address): Promise<bigint | null> {
  const result = await blockscoutGet<string>({
    module: "account",
    action: "balance",
    address,
  });

  if (result === null) return null;
  try {
    return BigInt(result);
  } catch {
    return null;
  }
}

export async function fetchFirstIncomingTransfer(
  address: Address,
  chainId?: number,
): Promise<{ funder: Address; blockNumber: bigint; timestamp: number } | null> {
  const pageSize = 100;
  const maxPages = 10;

  for (let page = 1; page <= maxPages; page++) {
    const txs = await fetchWalletTransactions(address, {
      sort: "asc",
      offset: pageSize,
      page,
      chainId,
    });

    if (txs.length === 0) break;

    const incoming = txs.find(
      (tx) => tx.to.toLowerCase() === address.toLowerCase() && BigInt(tx.value) > BigInt(0),
    );

    if (incoming) {
      return {
        funder: incoming.from as Address,
        blockNumber: BigInt(incoming.blockNumber),
        timestamp: Number(incoming.timeStamp),
      };
    }

    if (txs.length < pageSize) break;
  }

  return null;
}

/**
 * The wallet's first transaction AND its first *incoming* transfer, in one
 * pass over the ascending txlist.
 *
 * fetchWalletMetrics used to ask for these separately: a txlist call with
 * offset=1 purely to read the first transaction, alongside
 * fetchFirstIncomingTransfer's offset=100 walk whose page 1 re-fetches that
 * very same row. Same endpoint, same sort, same starting row — the small call
 * was pure duplication, and duplication is what costs here, because the
 * limiter counts requests (see the note on MAX_ATTEMPTS above). Folding them
 * together removes a third of the requests every score makes, and removes the
 * chance of the two halves disagreeing about which transaction came first.
 *
 * Deliberately kept separate from fetchFirstIncomingTransfer, which the funder
 * indexer still uses on its own and which has no use for the first tx.
 */
export async function fetchWalletHistoryHead(
  address: Address,
  chainId?: number,
): Promise<{
  firstTx: BlockscoutTx | null;
  incoming: { funder: Address; blockNumber: bigint; timestamp: number } | null;
}> {
  const pageSize = 100;
  const maxPages = 10;
  const addressLower = address.toLowerCase();
  let firstTx: BlockscoutTx | null = null;

  for (let page = 1; page <= maxPages; page++) {
    const txs = await fetchWalletTransactions(address, {
      sort: "asc",
      offset: pageSize,
      page,
      chainId,
    });

    if (txs.length === 0) break;
    if (page === 1) firstTx = txs[0] ?? null;

    const incoming = txs.find(
      (tx) => tx.to.toLowerCase() === addressLower && BigInt(tx.value) > BigInt(0),
    );

    if (incoming) {
      return {
        firstTx,
        incoming: {
          funder: incoming.from as Address,
          blockNumber: BigInt(incoming.blockNumber),
          timestamp: Number(incoming.timeStamp),
        },
      };
    }

    if (txs.length < pageSize) break;
  }

  return { firstTx, incoming: null };
}

/**
 * normalizeWalletScore (src/lib/scoring/helpers.ts) stops rewarding tx count
 * past this — 100+ and 100,000+ score identically. Paginating beyond it buys
 * nothing but request budget.
 */
const TX_COUNT_SATURATION = 100;

/**
 * 2026-08-13: このページ送りに早期終了が無かった。毎ページ満杯(100件)を返す
 * 限り、活動量に関わらず必ず20ページ＝2000件ぶんを走査していた——スコアリング
 * が txCount>=100 から先を区別しないのに。高活動ウォレット（取引所のホット
 * ウォレット等）は必ず20ページ全部を消費し、それだけで Blockscout の
 * 「~15リクエストで429」を単独で超える（このファイル冒頭の実測コメント参照）。
 * 信頼シグナルの向きが逆転する: 活動が多いほど wallet_metrics_unavailable に
 * 落ちやすくなり、fail-closed で BLOCK される。
 *
 * スコアリングが区別できる閾値に届いた時点で止める。区別できない情報を
 * 集め続けるのをやめるだけで、txCount>=100 という答え自体は変わらない。
 */
export async function estimateTransactionCount(address: Address, chainId?: number): Promise<number> {
  const pageSize = 100;
  const addressLower = address.toLowerCase();
  let nonSelf = 0;

  for (let page = 1; page <= 20; page++) {
    const txs = await fetchWalletTransactions(address, { sort: "desc", offset: pageSize, page, chainId });
    if (txs.length === 0) break;

    for (const tx of txs) {
      const involvesSelf =
        tx.from.toLowerCase() === addressLower && tx.to.toLowerCase() === addressLower;
      if (!involvesSelf) {
        nonSelf++;
      }
    }

    if (nonSelf >= TX_COUNT_SATURATION) break;
    if (txs.length < pageSize) break;
  }

  return nonSelf;
}
