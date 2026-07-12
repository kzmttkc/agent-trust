import { type Address, isAddress, zeroAddress } from "viem";
import { isSkipChainReadsEnabled } from "@/lib/config/env";
import { getPublicClient } from "./client";
import { ERC8004_ADDRESSES } from "./config";

const identityRegistryAbi = [
  {
    type: "function",
    name: "getAgentWallet",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

export async function readCanonicalAgentWallet(agentId: bigint): Promise<Address | null> {
  if (isSkipChainReadsEnabled()) return null;

  const client = getPublicClient();

  try {
    const wallet = await client.readContract({
      address: ERC8004_ADDRESSES.identityRegistry,
      abi: identityRegistryAbi,
      functionName: "getAgentWallet",
      args: [agentId],
    });

    if (!isAddress(wallet) || wallet === zeroAddress) {
      return null;
    }

    return wallet;
  } catch {
    return null;
  }
}
