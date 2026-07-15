#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { explainTrustScore } from "./explain.js";
import {
  attestX402Payment,
  fetchAgentScore,
  fetchPayeeScore,
  fetchWalletScore,
  VouchApiError,
} from "./vouch-client.js";

const server = new McpServer({
  name: "vouch-trust",
  version: "0.1.0",
});

const AGENT_ID = z.string().max(78).describe("ERC-8004 agent ID (tokenId)");
const WALLET = z.string().max(42).describe("EVM wallet address (0x...)");
const TX_HASH = z.string().max(66).describe("Payment transaction hash (0x + 64 hex)");

// Every error code the Vouch API can return for the endpoints this MCP server calls
// (agents/:id/score, wallets/:address/score, payees/:address/score, payments/x402).
// Keep in sync with src/app/api/v1/* and docs/openapi.yaml ErrorResponse.error enum.
const KNOWN_ERROR_CODES = new Set([
  "invalid_request",
  "invalid_agent_id",
  "invalid_wallet_address",
  "invalid_tx_hash",
  "attestation_unverifiable",
  "missing_api_key",
  "invalid_api_key",
  "auth_unavailable",
  "rate_limit_exceeded",
  "scoring_unavailable",
  "payment_ingest_unavailable",
]);

function sanitizeToolError(error: unknown): string {
  if (!(error instanceof Error)) return "request_failed";
  if (!KNOWN_ERROR_CODES.has(error.message)) return "request_failed";

  const reason = error instanceof VouchApiError ? error.reason : undefined;
  return reason ? `${error.message}: ${reason}` : error.message;
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
  "check_payee_trust",
  "Buyer-side check before paying a wallet: payee trust score (0-100), dataDepth (thin/moderate/rich), and ALLOW/WARN/BLOCK recommendation.",
  {
    payee: WALLET.describe("Payee wallet address (0x...) the agent is about to pay"),
  },
  async ({ payee }) => {
    try {
      const result = await fetchPayeeScore(payee);
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
