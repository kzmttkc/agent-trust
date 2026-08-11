// ============================================================
// Vouch — the ERC-8004 ABI must match the CONTRACT THAT IS DEPLOYED.
//
// WHY (2026-08-12). fetchReputationSummary called
//   getSummary(uint256, address[], bytes32, bytes32)   → selector 0x31259cff
// That function does not exist on the registry. Its selector is absent from
// the implementation bytecode behind the 0x8004BAa1… proxy, so every call
// reverted — for every agent, on every request, since the feature shipped.
//
// Nothing caught it, because the failure was INDISTINGUISHABLE FROM CORRECT
// BEHAVIOUR at every layer above: the engine dutifully converted the revert
// into `reputation_summary_unavailable`, assessSybilRisk mapped that to high
// risk, and the API returned a confident BLOCK with a plausible reason code.
// The fail-closed design worked perfectly and hid a total feature outage
// behind it. Every score on the site read 3/BLOCK for that reason alone.
//
// A wrong ABI is a silent, permanent outage, so the selector is pinned here.
// These are the bytes the deployed registry actually answers to; they were
// read off Base mainnet, not off a spec document.
// ============================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import { toFunctionSelector } from "viem";

// Read off the deployed implementation (0x16e0fa7f…) behind the registry proxy.
const DEPLOYED_SELECTORS = {
  getSummary: "0x81bbba58",
  getClients: "0x42dd519c",
} as const;

test("getSummary matches the deployed registry (string tags, not bytes32)", () => {
  assert.equal(
    toFunctionSelector(
      "function getSummary(uint256 agentId, address[] clientAddresses, string tag1, string tag2) view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)",
    ),
    DEPLOYED_SELECTORS.getSummary,
  );

  // The signature that shipped and never worked. Kept as a tombstone so a
  // future "tidy-up" back to bytes32 tags fails loudly instead of silently
  // BLOCKing every agent on the network again.
  assert.notEqual(
    toFunctionSelector(
      "function getSummary(uint256 agentId, address[] clientAddresses, bytes32 tag1, bytes32 tag2) view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)",
    ),
    DEPLOYED_SELECTORS.getSummary,
  );
});

test("getClients matches the deployed registry", () => {
  assert.equal(
    toFunctionSelector("function getClients(uint256 agentId) view returns (address[])"),
    DEPLOYED_SELECTORS.getClients,
  );
});

test("identity registry reads match the deployed registry", () => {
  // These three were always correct — pinned so the whole identity path is
  // covered by the same guard rather than only the one that broke.
  assert.equal(toFunctionSelector("function ownerOf(uint256 tokenId) view returns (address)"), "0x6352211e");
  assert.equal(toFunctionSelector("function tokenURI(uint256 tokenId) view returns (string)"), "0xc87b56dd");
  assert.equal(
    toFunctionSelector("function getAgentWallet(uint256 agentId) view returns (address)"),
    "0x00339509",
  );
});
