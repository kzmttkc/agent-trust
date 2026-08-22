#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { explainTrustScore } from "./explain.js";
import { sanitizeToolError } from "./tool-errors.js";
import {
  attestX402Payment,
  fetchAgentScore,
  fetchPayeeScore,
  fetchWalletScore,
} from "./vouch-client.js";

const server = new McpServer({
  name: "vouch-trust",
  version: "0.1.0",
});

const AGENT_ID = z.string().max(78).describe("ERC-8004 agent ID (tokenId)");
const WALLET = z.string().max(42).describe("EVM wallet address (0x...)");
const TX_HASH = z.string().max(66).describe("Payment transaction hash (0x + 64 hex)");

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

// The description is the only thing the model reads before deciding what the
// result MEANS. It used to name score / dataDepth / ALLOW-WARN-BLOCK and stop
// there, so a model that got a `degraded` body with a stale ALLOW in it had
// no instruction not to act on it. The raw JSON always carried the two fields
// (the tool returns JSON.stringify of the whole body); nothing told the model
// they outrank the recommendation. Now it does. — 2026-08-22 audit
server.tool(
  "check_payee_trust",
  [
    "Buyer-side check before paying a wallet: payee trust score (0-100),",
    "dataDepth (thin/moderate/rich), and ALLOW/WARN/BLOCK recommendation.",
    "",
    "The result ALSO carries two fields that OVERRIDE the recommendation:",
    "- degraded (boolean): true means an input could not be read at all, so",
    "  the body is a refusal, not a measurement.",
    "- signalsUnavailable (array): non-empty means some inputs were not",
    "  measured (e.g. wallet_metrics, native_drain, usdc_drain,",
    "  outcome_history), so the view is partial.",
    "",
    "DO NOT treat the payee as ALLOW if degraded is true or signalsUnavailable",
    "is non-empty — whatever recommendation and score say. Both mean the payee",
    "was not fully checked, and an unchecked payee is not a safe one. The same",
    "applies when this tool returns an error (including lookup_timeout): no",
    "answer is not an ALLOW. Re-check before paying rather than assuming.",
  ].join("\n"),
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
