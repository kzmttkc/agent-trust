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
 * of wallet age / tx-count / funder data. That is exactly the failure that
 * surfaced as the showcase agent scoring 48/BLOCK with sybilRisk:"high" and
 * walletAgeDays 0 — a rate-limited fetch throws, the engine flags
 * wallet_metrics_unavailable, and the verdict is (correctly, but needlessly)
 * failed closed.
 *
 * Probing the API from outside with a few spaced-out requests reports it
 * perfectly healthy, which is why upstream looked fine while Vouch was cut off:
 * the load pattern, not the endpoint, is what fails.
 *
 * MEASURED 2026-08-13 against base.blockscout.com, and the numbers are far
 * harsher than the "~15 requests" this file used to claim:
 *
 *   - the etherscan-compatible `/api?module=...` (v1) endpoint answers 3
 *     back-to-back requests and returns HTTP 429 on the 4th;
 *   - once tripped it is a PENALTY BOX, not a token bucket: requests kept
 *     drawing 429 for 95+ seconds, and every request made while limited
 *     extends the lockout. Retrying a 429 does not recover it — it deepens it;
 *   - the `/api/v2/...` endpoints on the same host are governed by a
 *     SEPARATE and far more permissive limiter: 17 consecutive
 *     `/addresses/{a}/counters` calls with no pacing at all returned 200.
 *
 * That measurement is what the two mechanisms below encode:
 *
 *   1. PACING (`passRateGate`) — v1 request starts are serialized and spaced,
 *      so a scan cannot fire the burst that trips the limiter in the first
 *      place. This is the actual repair: the previous code had no pacing at
 *      all, so the weekly benchmark scan tripped the limiter on its 5th
 *      address and then failed closed on all 37 remaining ones.
 *   2. COOLDOWN (`openRateLimitCooldown`) — once a refusal is seen, callers
 *      stop issuing v1 requests for a while instead of hammering the penalty
 *      box deeper. The old policy retried a 429 after 250ms, three times, for
 *      every address; that is the behaviour that turned one refusal into a
 *      run-long outage.
 *
 * NEITHER SOFTENS A VERDICT. A read that genuinely cannot be completed still
 * throws, the caller still flags `wallet_metrics_unavailable`, and the engine
 * still fails closed to BLOCK. Both mechanisms only stop Vouch from
 * manufacturing the outage it then fails closed on.
 */
const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 250;

/** Minimum spacing between v1 request STARTS. 3 rapid requests trip the
 *  limiter; 1.5s spacing got 9 addresses through a production scan before it
 *  tripped (measured 2026-08-13, 21:44:54-21:45:09Z), so the budget is a slow
 *  refill rather than a per-second rate. Spaced further out accordingly. */
const DEFAULT_V1_MIN_INTERVAL_MS = 2_500;
/**
 * How long to stop issuing v1 requests after a refusal is observed.
 *
 * ESCALATING, because the limiter is a penalty box that COUNTS the requests
 * made while it is shut. Measured 2026-08-13 in production: a flat 10s cooldown
 * left the scan poking the box every 10 seconds, and it never reopened — the
 * poke itself kept renewing the lockout, so 9 addresses read cleanly and the
 * next 8 all recorded "unavailable" while the box stayed shut for the rest of
 * the run. Locally the same box stayed shut for 95+ seconds under 5s polling.
 *
 * So each consecutive refusal doubles the wait, and the first success resets
 * it. If the block was a blip we are back within seconds; if it is a real
 * lockout we stop feeding it.
 */
const DEFAULT_V1_COOLDOWN_MS = 15_000;
const MAX_V1_COOLDOWN_MS = 120_000;

function envMs(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

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

// ---- v1 request pacing + cooldown ------------------------------------------
// Process-wide on purpose: the limiter counts requests per client, so a
// per-caller budget would be no budget at all. `gateTail` is a promise chain
// each caller appends itself to, which serializes the WAIT (not the request):
// callers take their turn, sleep out the remaining interval, then fire.
let gateTail: Promise<unknown> = Promise.resolve();
let lastRequestStartedAt = 0;
let rateLimitCooldownUntil = 0;
let consecutiveRefusals = 0;

/** Milliseconds remaining before v1 requests may resume. 0 = go. */
function cooldownRemainingMs(): number {
  return Math.max(0, rateLimitCooldownUntil - Date.now());
}

/**
 * How long until v1 reads are worth attempting again.
 *
 * Exported for callers that can afford to WAIT rather than fail — the weekly
 * benchmark scan has a 240s budget and nobody on the other end of it, so
 * pausing is strictly better than recording 33 fail-closed BLOCKs (measured
 * 2026-08-13: the scan tripped the limiter on its 10th address and then burned
 * every remaining entry inside a single cooldown, because failing fast is
 * instant). Live scoring must keep failing fast instead — a caller waiting on
 * an x402 verdict cannot be held for ten seconds.
 */
export function blockscoutCooldownRemainingMs(): number {
  return cooldownRemainingMs();
}

function openRateLimitCooldown(): void {
  const base = envMs("BLOCKSCOUT_COOLDOWN_MS", DEFAULT_V1_COOLDOWN_MS);
  const cap = envMs("BLOCKSCOUT_COOLDOWN_MAX_MS", MAX_V1_COOLDOWN_MS);
  consecutiveRefusals++;
  const backoff = Math.min(base * 2 ** (consecutiveRefusals - 1), cap);
  rateLimitCooldownUntil = Math.max(rateLimitCooldownUntil, Date.now() + backoff);
}

/** A completed read means the box is open again — start the ladder over. */
function noteRequestSucceeded(): void {
  consecutiveRefusals = 0;
}

async function passRateGate(): Promise<void> {
  const minInterval = envMs("BLOCKSCOUT_MIN_INTERVAL_MS", DEFAULT_V1_MIN_INTERVAL_MS);
  if (minInterval <= 0) return;
  const turn = gateTail.then(async () => {
    const wait = lastRequestStartedAt + minInterval - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestStartedAt = Date.now();
  });
  // A rejected link must not poison every caller queued behind it.
  gateTail = turn.catch(() => undefined);
  await turn;
}

/** Test seam: drop the pacing/cooldown state so cases do not inherit each
 *  other's timing. Never called by product code. */
export function resetBlockscoutRateGate(): void {
  gateTail = Promise.resolve();
  lastRequestStartedAt = 0;
  rateLimitCooldownUntil = 0;
  consecutiveRefusals = 0;
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

  // Refuse to spend a request we already know will be refused. Not retryable:
  // the whole point is to stop adding requests to a penalty box that counts
  // them. The caller still gets an error and still fails closed.
  if (cooldownRemainingMs() > 0) {
    throw new BlockscoutUnavailableError("blockscout_rate_limit_cooldown", undefined, false);
  }
  await passRateGate();

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      next: { revalidate: 0 },
    });
  } catch (error) {
    // Connection reset / DNS / socket hang-up: worth one more try. A network
    // blip is not a rate limit, so it does not open the cooldown.
    throw new BlockscoutUnavailableError("blockscout_network_error", error, true);
  }

  if (!response.ok) {
    // 429 = rate limited: measured to be a penalty box, so back off globally
    // and do NOT retry — a retry is what deepens it. 5xx = their side is
    // unwell, which does pass with time and is worth one more try.
    // Any other 4xx is our request being wrong; repeating it changes nothing.
    if (response.status === 429) {
      openRateLimitCooldown();
      throw new BlockscoutUnavailableError("blockscout_http_429", undefined, false);
    }
    throw new BlockscoutUnavailableError(
      `blockscout_http_${response.status}`,
      undefined,
      response.status >= 500,
    );
  }

  let data: BlockscoutResponse<T>;
  try {
    data = (await response.json()) as BlockscoutResponse<T>;
  } catch (error) {
    throw new BlockscoutUnavailableError("blockscout_invalid_json", error);
  }

  if (data.status === "1" && data.result) {
    noteRequestSucceeded();
    return data.result;
  }

  if (isEmptyResultMessage(data.message ?? "")) {
    noteRequestSucceeded();
    return null;
  }

  // Ambiguous status=0 without an empty-result message → treat as outage/rate-limit.
  // Blockscout also serves its rate-limit refusal this way (HTTP 200 with
  // status:"0" and a "Too many requests" message), so read the message too.
  const message = data.message ?? "";
  if (isRateLimitMessage(message)) {
    // Same refusal as a 429, just dressed as HTTP 200. Same response: back off
    // globally, do not retry into the penalty box.
    openRateLimitCooldown();
    throw new BlockscoutUnavailableError(`blockscout_api_error:${message}`, undefined, false);
  }
  throw new BlockscoutUnavailableError(
    `blockscout_api_error:${message || data.status || "unknown"}`,
    undefined,
    false,
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
 * normalizeWalletScore (src/lib/scoring/helpers.ts) stops rewarding tx count
 * past this — 100+ and 100,000+ score identically. Paginating beyond it buys
 * nothing but request budget.
 */
const TX_COUNT_SATURATION = 100;

/** Hard ceiling on the ascending walk. Reached only by a wallet whose oldest
 *  pages are almost entirely self-transfers; everything else saturates or runs
 *  out of history on page 1. */
const MAX_HISTORY_PAGES = 10;

/**
 * Total transaction count from Blockscout's v2 `/addresses/{a}/counters`.
 * Returns null when the answer cannot be obtained — never a number it made up.
 *
 * WHY A SECOND ENDPOINT (2026-08-13). The v1 etherscan-compatible API and the
 * v2 API on the same host are governed by SEPARATE limiters, and they are not
 * close: v1 refuses the 4th rapid request and then sulks for 95+ seconds, while
 * 17 consecutive v2 counter reads with no pacing whatsoever all returned 200 —
 * measured while v1 was still refusing everything.
 *
 * This is used for exactly one decision: "does this address have any history on
 * this chain at all?". 25 of the benchmark's 42 addresses are OFAC-listed
 * mainnet addresses with zero Base activity, and asking v1 to page through an
 * empty history spent 25 of the scarcest requests in the system to be told
 * nothing. A zero here is a real answer from the same source of truth, and it
 * is the answer the v1 walk would have produced (no first tx, no funder, no
 * transactions) — so the walk is skipped, not guessed at.
 *
 * A WRONG zero would read as a brand-new wallet, which scores DOWN
 * (new_burner_wallet) — the safe direction. A missing answer falls through to
 * the v1 walk, and if that fails too the caller still fails closed.
 */
export async function fetchAddressTransactionCount(
  address: Address,
  chainId?: number,
): Promise<number | null> {
  const base = getBlockscoutBaseUrl(chainId).replace(/\/+$/, "");
  try {
    const response = await fetch(`${base}/v2/addresses/${address}/counters`, {
      headers: { Accept: "application/json" },
      next: { revalidate: 0 },
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { transactions_count?: string | number };
    const raw = data?.transactions_count;
    if (raw === undefined || raw === null) return null;
    const count = Number(raw);
    return Number.isFinite(count) && count >= 0 ? count : null;
  } catch {
    return null;
  }
}

// ---- v2 transfer reads ------------------------------------------------------
/**
 * WHY THESE EXIST (2026-08-13). The payee engine's drain check used to make
 * FOUR v1 reads in one Promise.all (txlist, balance, tokentx, tokenbalance).
 * The measurement at the top of this file says the v1 limiter answers three
 * back-to-back requests and then refuses — so that check could not succeed
 * even alone, and it shared its budget with fetchWalletMetrics' own v1 walk.
 * Measured the same day: base.blockscout.com's v1 endpoints returned 429 to a
 * single spaced request while `/api/v2/...` on the same host answered 200,
 * which is the separate-limiter claim above holding in production.
 *
 * So the transfer history moves to v2 and the two balances move to the RPC
 * (see payee-engine), taking the drain check from four v1 requests to zero.
 * These deliberately return the same BlockscoutTx shape as their v1
 * counterparts: the callers' arithmetic is unchanged, only the source is.
 *
 * Failure semantics are the v1 ones, NOT fetchAddressTransactionCount's: a
 * read that did not complete throws, so the caller still fails closed. That
 * function may return null because a null there falls through to a second
 * source; there is no second source here.
 */
type BlockscoutV2Page = {
  items?: unknown[];
  next_page_params?: Record<string, string | number | null> | null;
};

async function blockscoutV2GetOnce<T extends BlockscoutV2Page>(
  path: string,
  params: Record<string, string>,
  chainId?: number,
): Promise<T> {
  const base = getBlockscoutBaseUrl(chainId).replace(/\/+$/, "");
  const url = new URL(`${base}/v2${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      next: { revalidate: 0 },
    });
  } catch (error) {
    throw new BlockscoutUnavailableError("blockscout_v2_network_error", error, true);
  }

  if (!response.ok) {
    // No openRateLimitCooldown() even on a 429: the v2 limiter is a separate
    // budget, and pausing v1 reads because v2 was busy would spread an outage
    // rather than contain it.
    throw new BlockscoutUnavailableError(
      `blockscout_v2_http_${response.status}`,
      undefined,
      response.status >= 500,
    );
  }

  try {
    return (await response.json()) as T;
  } catch (error) {
    throw new BlockscoutUnavailableError("blockscout_v2_invalid_json", error);
  }
}

async function blockscoutV2Get<T extends BlockscoutV2Page>(
  path: string,
  params: Record<string, string>,
  chainId?: number,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await blockscoutV2GetOnce<T>(path, params, chainId);
    } catch (error) {
      lastError = error;
      const retryable = error instanceof BlockscoutUnavailableError && error.retryable;
      if (!retryable || attempt === MAX_ATTEMPTS) break;
      await sleep(retryDelayMs(attempt));
    }
  }
  throw lastError;
}

/** One v2 page is 50 items; the v1 calls these replace read offset=100, so the
 *  drain window must not shrink — a shorter window counts less outflow, which
 *  is the fail-OPEN direction on a drain ratio. */
const V2_PAGE_SIZE = 50;
const V2_MAX_PAGES = 2;

async function fetchV2Transfers<T>(
  path: string,
  baseParams: Record<string, string>,
  limit: number,
  toTx: (item: T) => BlockscoutTx | null,
  chainId?: number,
): Promise<BlockscoutTx[]> {
  const out: BlockscoutTx[] = [];
  let params: Record<string, string> = { ...baseParams };

  for (let page = 1; page <= V2_MAX_PAGES; page++) {
    const data = await blockscoutV2Get<BlockscoutV2Page>(path, params, chainId);
    const items = (data.items ?? []) as T[];
    for (const item of items) {
      const tx = toTx(item);
      if (tx) out.push(tx);
      if (out.length >= limit) return out;
    }
    const next = data.next_page_params;
    if (!next || items.length < V2_PAGE_SIZE) break;
    params = { ...baseParams };
    for (const [key, value] of Object.entries(next)) {
      if (value !== null && value !== undefined) params[key] = String(value);
    }
  }

  return out;
}

type V2NativeTx = {
  hash?: string;
  block_number?: number;
  timestamp?: string;
  value?: string;
  from?: { hash?: string } | null;
  to?: { hash?: string } | null;
};

type V2TokenTransfer = {
  transaction_hash?: string;
  block_number?: number;
  timestamp?: string;
  total?: { value?: string } | null;
  from?: { hash?: string } | null;
  to?: { hash?: string } | null;
};

function toEpochSeconds(iso: string | undefined): string {
  if (!iso) return "0";
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? String(Math.floor(ms / 1000)) : "0";
}

/** Native-token transfers, newest first — the v2 replacement for
 *  fetchWalletTransactions({ sort: "desc" }). */
export async function fetchWalletTransfersV2(
  address: Address,
  options: { limit?: number; chainId?: number } = {},
): Promise<BlockscoutTx[]> {
  return fetchV2Transfers<V2NativeTx>(
    `/addresses/${address}/transactions`,
    {},
    options.limit ?? 100,
    (item) => {
      const from = item.from?.hash;
      const to = item.to?.hash;
      // A contract creation has no `to`. It moves value out of the wallet, so
      // dropping it would understate outflow — count it against a burn-shaped
      // address rather than silently ignoring it.
      if (!from) return null;
      return {
        hash: item.hash ?? "",
        blockNumber: String(item.block_number ?? 0),
        timeStamp: toEpochSeconds(item.timestamp),
        from,
        to: to ?? "0x0000000000000000000000000000000000000000",
        value: item.value ?? "0",
      };
    },
    options.chainId,
  );
}

/** ERC-20 transfers for one token, newest first — the v2 replacement for
 *  fetchTokenTransfers({ contractAddress }). The token filter is applied
 *  server-side by `token=`; items without a numeric total are dropped rather
 *  than counted as zero. */
export async function fetchTokenTransfersV2(
  address: Address,
  contractAddress: Address,
  options: { limit?: number; chainId?: number } = {},
): Promise<BlockscoutTx[]> {
  return fetchV2Transfers<V2TokenTransfer>(
    `/addresses/${address}/token-transfers`,
    { token: contractAddress, type: "ERC-20" },
    options.limit ?? 100,
    (item) => {
      const from = item.from?.hash;
      const to = item.to?.hash;
      const value = item.total?.value;
      if (!from || !to || value === undefined || value === null) return null;
      return {
        hash: item.transaction_hash ?? "",
        blockNumber: String(item.block_number ?? 0),
        timeStamp: toEpochSeconds(item.timestamp),
        from,
        to,
        value,
      };
    },
    options.chainId,
  );
}

export interface WalletHistoryHead {
  /** Oldest transaction on this chain — the wallet's age. */
  firstTx: BlockscoutTx | null;
  /** Oldest incoming value transfer — who funded this wallet. */
  incoming: { funder: Address; blockNumber: bigint; timestamp: number } | null;
  /** Transactions not counting self-to-self, over the pages scanned, capped at
   *  TX_COUNT_SATURATION (scoring cannot tell 100 from 100,000 apart). */
  nonSelfTxCount: number;
}

/**
 * Everything fetchWalletMetrics needs about a wallet's history, in ONE pass.
 *
 * WHY THIS IS ONE FUNCTION (2026-08-13). It used to be two, and they ran
 * concurrently: this ascending walk for age + funder, and
 * estimateTransactionCount's DESCENDING walk for the tx count. Two walks over
 * the same endpoint, for the same wallet, at the same instant — and the v1
 * limiter answers three requests before it starts refusing (see the measured
 * note at the top of this file). So the cheapest possible score already cost
 * two thirds of the burst budget, and the weekly benchmark scan — 42 addresses
 * back to back — tripped the limiter on its 5th address and then failed closed
 * on all 37 that followed. Measured in production 2026-08-12: 15 of 17 known-
 * good addresses came back ageDays:0 / txCount:0 / wallet_metrics_unavailable
 * → sybil high → BLOCK, and /accuracy published that as an 88.2% false-
 * positive rate against addresses whose only sin was being scanned late.
 *
 * The two walks read the SAME rows. A wallet with ≤100 transactions has its
 * entire history on page 1, so the descending call could only ever re-fetch
 * what the ascending call already held; a wallet with more than that saturates
 * the count on page 1 either way. Merging them halves the request cost of every
 * score without changing a single number either walk produced — the count is
 * still the non-self count (self-transfers still excluded, so a wallet cannot
 * inflate its activity by paying gas to itself), the age is still the oldest
 * transaction, the funder is still the oldest incoming value transfer.
 *
 * Deliberately kept separate from fetchFirstIncomingTransfer, which the funder
 * indexer still uses on its own and which has no use for the first tx.
 */
export async function fetchWalletHistoryHead(
  address: Address,
  chainId?: number,
): Promise<WalletHistoryHead> {
  const pageSize = 100;
  const addressLower = address.toLowerCase();
  let firstTx: BlockscoutTx | null = null;
  let incoming: WalletHistoryHead["incoming"] = null;
  let nonSelfTxCount = 0;

  for (let page = 1; page <= MAX_HISTORY_PAGES; page++) {
    const txs = await fetchWalletTransactions(address, {
      sort: "asc",
      offset: pageSize,
      page,
      chainId,
    });

    if (txs.length === 0) break;
    if (page === 1) firstTx = txs[0] ?? null;

    for (const tx of txs) {
      const from = tx.from.toLowerCase();
      const to = tx.to.toLowerCase();
      if (!(from === addressLower && to === addressLower)) {
        nonSelfTxCount++;
      }
      if (!incoming && to === addressLower && BigInt(tx.value) > BigInt(0)) {
        incoming = {
          funder: tx.from as Address,
          blockNumber: BigInt(tx.blockNumber),
          timestamp: Number(tx.timeStamp),
        };
      }
    }

    // Both remaining questions are answered: the funder is known and the count
    // has passed the last threshold scoring can distinguish. More pages cannot
    // change any signal derived from this walk.
    if (incoming && nonSelfTxCount >= TX_COUNT_SATURATION) break;
    // A short page is the end of history — the count is now exact.
    if (txs.length < pageSize) break;
  }

  return { firstTx, incoming, nonSelfTxCount };
}
