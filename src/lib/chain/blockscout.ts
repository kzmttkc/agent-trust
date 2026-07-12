import type { Address } from "viem";

type BlockscoutTx = {
  hash: string;
  blockNumber: string;
  timeStamp: string;
  from: string;
  to: string;
  value: string;
};

type BlockscoutResponse<T> = {
  status: string;
  message: string;
  result: T;
};

function getBlockscoutBaseUrl(): string {
  return process.env.BLOCKSCOUT_API_URL ?? "https://base.blockscout.com/api";
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

  try {
    const response = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      next: { revalidate: 0 },
    });

    if (!response.ok) return null;

    const data = (await response.json()) as BlockscoutResponse<T>;
    if (data.status !== "1" || !data.result) return null;
    return data.result;
  } catch {
    return null;
  }
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
