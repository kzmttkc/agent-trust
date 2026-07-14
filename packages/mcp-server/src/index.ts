#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { explainTrustScore } from "./explain.js";
import { attestX402Payment, fetchAgentScore, fetchWalletScore } from "./vouch-client.js";

const server = new McpServer({
  name: "vouch-trust",
  version: "0.1.0",
});

const AGENT_ID = z.string().max(78).describe("ERC-8004 agent ID (tokenId)");
const WALLET = z.string().max(42).describe("EVM wallet address (0x...)");
const TX_HASH = z.string().max(66).describe("Payment transaction hash (0x + 64 hex)");

function sanitizeToolError(error: unknown): string {
  if (!(error instanceof Error)) return "request_failed";
  const known = new Set([
    "invalid_agent_id",
    "invalid_wallet_address",
    "invalid_tx_hash",
    "missing_api_key",
    "invalid_api_key",
    "rate_limit_exceeded",
    "scoring_unavailable",
    "payment_ingest_unavailable",
  ]);
  return known.has(error.message) ? error.message : "request_failed";
}

server.tool(
  "check_agent_trust",
  "Get ERC-8004 agent trust score (0-100) and ALLOW/WARN/BLOCK recommendation on Base.",
  {
    agentId: AGENT_ID,
    wallet: WALLET.optional().describe("Optional wallet to verify against agentWallet metadata"),
  },
  async ({ agentId, wallet }) => {
    try {
      const result = await fetchAgentScore(agentId, wallet);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: sanitizeToolError(error) }],
        isError: true,
      };
    }
  },
);

server.tool(
  "check_wallet_trust",
  "Get trust score for a wallet address. Resolves ERC-8004 agents when registered.",
  {
    wallet: WALLET,
  },
  async ({ wallet }) => {
    try {
      const result = await fetchWalletScore(wallet);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: sanitizeToolError(error) }],
        isError: true,
      };
    }
  },
);

server.tool(
  "explain_trust_score",
  "Explain a trust score breakdown in plain language for an agent or wallet.",
  {
    agentId: AGENT_ID.optional(),
    wallet: WALLET.optional(),
  },
  async ({ agentId, wallet }) => {
    try {
      if (!agentId && !wallet) {
        throw new Error("agentId or wallet is required");
      }

      const result = agentId
        ? await fetchAgentScore(agentId, wallet)
        : await fetchWalletScore(wallet!);

      return {
        content: [{ type: "text", text: explainTrustScore(result) }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: sanitizeToolError(error) }],
        isError: true,
      };
    }
  },
);

server.tool(
  "attest_x402_payment",
  "Record an x402 payment attestation after settlement verification (idempotent on txHash).",
  {
    wallet: WALLET,
    txHash: TX_HASH,
    amount: z.string().max(78).optional(),
    network: z.string().max(32).optional(),
    resource: z.string().max(512).optional(),
  },
  async ({ wallet, txHash, amount, network, resource }) => {
    try {
      const result = await attestX402Payment({
        wallet,
        txHash,
        amount,
        network,
        resource,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: sanitizeToolError(error) }],
        isError: true,
      };
    }
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
