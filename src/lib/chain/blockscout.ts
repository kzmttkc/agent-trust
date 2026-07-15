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
  constructor(message = "blockscout_unavailable", cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = "BlockscoutUnavailableError";
  }
}

function getBlockscoutBaseUrl(): string {
  return process.env.BLOCKSCOUT_API_URL ?? "https://base.blockscout.com/api";
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

async function blockscoutGet<T>(params: Record<string, string>): Promise<T | null> {
  const url = new URL(getBlockscoutBaseUrl());
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
    throw new BlockscoutUnavailableError("blockscout_network_error", error);
  }

  if (!response.ok) {
    throw new BlockscoutUnavailableError(`blockscout_http_${response.status}`);
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
  throw new BlockscoutUnavailableError(
    `blockscout_api_error:${data.message || data.status || "unknown"}`,
  );
}

export async function fetchWalletTransactions(
  address: Address,
  options: { sort?: "asc" | "desc"; offset?: number; page?: number } = {},
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
  });

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
): Promise<{ funder: Address; blockNumber: bigint; timestamp: number } | null> {
  const pageSize = 100;
  const maxPages = 10;

  for (let page = 1; page <= maxPages; page++) {
    const txs = await fetchWalletTransactions(address, {
      sort: "asc",
      offset: pageSize,
      page,
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

export async function estimateTransactionCount(address: Address): Promise<number> {
  const pageSize = 100;
  const addressLower = address.toLowerCase();
  let nonSelf = 0;

  for (let page = 1; page <= 20; page++) {
    const txs = await fetchWalletTransactions(address, { sort: "desc", offset: pageSize, page });
    if (txs.length === 0) break;

    for (const tx of txs) {
      const involvesSelf =
        tx.from.toLowerCase() === addressLower && tx.to.toLowerCase() === addressLower;
      if (!involvesSelf) {
        nonSelf++;
      }
    }

    if (txs.length < pageSize) break;
  }

  return nonSelf;
}
