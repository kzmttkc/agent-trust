// ============================================================
// Vouch — operator benchmark dataset (2026-08-06).
//
// WHY THIS EXISTS. /accuracy has a chicken-and-egg problem: the page can
// only prove "measured, not asserted" once verdicts have outcomes, but with
// zero external usage there are no verdicts to measure. This dataset breaks
// the loop the only honest way available: the operator scores addresses
// whose real-world outcome is ALREADY publicly known, and publishes the
// result AS an operator benchmark — never mixed into, or dressed up as,
// external customer traffic. Hiding the self-seeded origin of these rows
// would turn the product's core claim into a fabrication, so the origin is
// stamped on every row (source = OPERATOR_BENCHMARK_SOURCE on the outcome,
// signals.kind = BENCHMARK_SEED_KIND on the trust event) and surfaced as a
// separate section on /accuracy.
//
// DATA SOURCES AND LICENSING (checked 2026-08-06):
//   - Known-bad: the US Treasury OFAC Specially Designated Nationals (SDN)
//     list, digital-currency (ETH) entries. A US federal government work —
//     public domain (17 U.S.C. §105), free to use and redistribute.
//     Retrieved via the nightly extraction at
//     https://github.com/0xB10C/ofac-sanctioned-digital-currency-addresses
//     (lists branch, sanctioned_addresses_ETH.txt, retrieved 2026-08-06);
//     the authoritative upstream is
//     https://www.treasury.gov/ofac/downloads/sanctions/1.0/sdn_advanced.xml
//   - ScamSniffer scam-database was evaluated and REJECTED: GPL-3.0. Vouch
//     is proprietary; embedding and republishing GPL-licensed data would
//     create license obligations we cannot meet. CryptoScamDB (MIT) was
//     evaluated and rejected as unmaintained (stale since ~2020, mostly
//     domains, not addresses).
//   - Known-good: long-operating, publicly attributed addresses with no
//     public adverse reports at assembly time. Attribution basis is recorded
//     per entry (official publication / on-chain ENS / public label
//     consensus). Every entry was verified to have actual Base activity
//     (base.blockscout.com counters, 2026-08-06) because the engine scores
//     Base — a mainnet-only treasury with no Base footprint would measure
//     chain coverage, not discrimination, so such candidates were excluded
//     by rule, not by result.
//
// GROUND-TRUTH SEMANTICS: "bad" = the world has already concluded this
// counterparty is one you should not have trusted (sanctioned). "good" =
// years of operation, public identity, no adverse findings. The engine's
// job on this set: BLOCK/WARN the bad (a miss = false negative), ALLOW the
// good (a BLOCK = false positive). See src/lib/scoring/benchmark-report.ts.
//
// All addresses are stored lowercase (isValidAddress is case-insensitive;
// verdict_outcomes.related_wallet comparisons lowercase at read time).
// ============================================================

/** `source` value on verdict_outcomes rows written by the benchmark runner.
 *  Everything that reads accuracy data partitions on this value — the
 *  external report EXCLUDES it, the benchmark report REQUIRES it. */
export const OPERATOR_BENCHMARK_SOURCE = "operator_benchmark";

/** `signals.kind` on trust_events rows written by the benchmark runner.
 *  Excluded from the outcome-detector watch set (outcome-writer.ts) so the
 *  auto detector never writes second-opinion outcomes for seeded rows, and
 *  usable as a filter by any ad-hoc usage measurement. */
export const BENCHMARK_SEED_KIND = "benchmark_seed";

/** Bumped whenever entries are added/removed so published aggregates can be
 *  traced to the exact address set that produced them (git history has the
 *  diff). */
export const BENCHMARK_DATASET_VERSION = 1;

export type BenchmarkLabel = "bad" | "good";

export interface BenchmarkEntry {
  /** lowercase 0x-address */
  address: string;
  label: BenchmarkLabel;
  /** e.g. 'ofac_sdn' | 'exchange_operational' | 'foundation_treasury' ... */
  category: string;
  sourceName: string;
  sourceUrl: string;
  /** why we believe the label — kept on the row as evidence */
  note: string;
}

const OFAC_SOURCE = {
  category: "ofac_sdn",
  sourceName: "US Treasury OFAC SDN list (digital currency addresses, ETH)",
  sourceUrl:
    "https://github.com/0xB10C/ofac-sanctioned-digital-currency-addresses",
} as const;

function bad(address: string, note: string): BenchmarkEntry {
  return { address, label: "bad", ...OFAC_SOURCE, note };
}

function good(
  address: string,
  category: string,
  sourceName: string,
  sourceUrl: string,
  note: string,
): BenchmarkEntry {
  return { address, label: "good", category, sourceName, sourceUrl, note };
}

/**
 * Known-bad: 25 of the 96 ETH addresses on the OFAC SDN list as of
 * 2026-08-06 (the two attributed entries first, then the list head in file
 * order — a deterministic rule, not a curation that could flatter the
 * engine). Tornado Cash pool addresses are absent because OFAC delisted
 * them in March 2025 and the retrieval is of the CURRENT list — a delisted
 * address is no longer ground-truth bad.
 */
const KNOWN_BAD: BenchmarkEntry[] = [
  bad("0x098b716b8aaf21512996dc57eb0615e2383e2f96", "Lazarus Group (Ronin Bridge exploit) — SDN listed 2022-04-14"),
  bad("0x53b6936513e738f44fb50d2b9476730c0ab3bfc1", "Lazarus Group (Harmony Horizon Bridge) — SDN listed"),
  bad("0x0330070fd38ec3bb94f58fa55d40368271e9e54a", "US OFAC SDN digital-currency address (ETH), list retrieved 2026-08-06"),
  bad("0x038989cbb1710c72b9920dc4fa529158f463e72c", "US OFAC SDN digital-currency address (ETH), list retrieved 2026-08-06"),
  bad("0x04dba1194ee10112fe6c3207c0687def0e78bacf", "US OFAC SDN digital-currency address (ETH), list retrieved 2026-08-06"),
  bad("0x08723392ed15743cc38513c4925f5e6be5c17243", "US OFAC SDN digital-currency address (ETH), list retrieved 2026-08-06"),
  bad("0x08b2efdcdb8822efe5ad0eae55517cf5dc544251", "US OFAC SDN digital-currency address (ETH), list retrieved 2026-08-06"),
  bad("0x0931ca4d13bb4ba75d9b7132ab690265d749a5e7", "US OFAC SDN digital-currency address (ETH), list retrieved 2026-08-06"),
  bad("0x0ee5067b06776a89ccc7dc8ee369984ad7db5e06", "US OFAC SDN digital-currency address (ETH), list retrieved 2026-08-06"),
  bad("0x12de548f79a50d2bd05481c8515c1ef5183666a9", "US OFAC SDN digital-currency address (ETH), list retrieved 2026-08-06"),
  bad("0x14779cec0b117d5194c750c55ea1f42086631964", "US OFAC SDN digital-currency address (ETH), list retrieved 2026-08-06"),
  bad("0x1967d8af5bd86a497fb3dd7899a020e47560daaf", "US OFAC SDN digital-currency address (ETH), list retrieved 2026-08-06"),
  bad("0x1999ef52700c34de7ec2b68a28aafb37db0c5ade", "US OFAC SDN digital-currency address (ETH), list retrieved 2026-08-06"),
  bad("0x19f8f2b0915daa12a3f5c9cf01df9e24d53794f7", "US OFAC SDN digital-currency address (ETH), list retrieved 2026-08-06"),
  bad("0x19aa5fe80d33a56d56c78e82ea5e50e5d80b4dff", "US OFAC SDN digital-currency address (ETH), list retrieved 2026-08-06"),
  bad("0x1d19b52b54e7ef5ea1a4b40b616165e798eac9f8", "US OFAC SDN digital-currency address (ETH), list retrieved 2026-08-06"),
  bad("0x1da5821544e25c636c1417ba96ade4cf6d2f9b5a", "US OFAC SDN digital-currency address (ETH), list retrieved 2026-08-06"),
  bad("0x21b8d56bda776bbe68655a16895afd96f5534fed", "US OFAC SDN digital-currency address (ETH), list retrieved 2026-08-06"),
  bad("0x2711d73d559f62f4f855ee21f38378f528e07985", "US OFAC SDN digital-currency address (ETH), list retrieved 2026-08-06"),
  bad("0x2c7dcd774b33e10367f7d6385479e04f97d179dc", "US OFAC SDN digital-currency address (ETH), list retrieved 2026-08-06"),
  bad("0x2f389ce8bd8ff92de3402ffce4691d17fc4f6535", "US OFAC SDN digital-currency address (ETH), list retrieved 2026-08-06"),
  bad("0x308ed4b7b49797e1a98d3818bff6fe5385410370", "US OFAC SDN digital-currency address (ETH), list retrieved 2026-08-06"),
  bad("0x32da24ca413f3e7b53145d4737e172c3bdf81e3e", "US OFAC SDN digital-currency address (ETH), list retrieved 2026-08-06"),
  bad("0x35fb6f6db4fb05e6a4ce86f2c93691425626d4b1", "US OFAC SDN digital-currency address (ETH), list retrieved 2026-08-06"),
  bad("0x39d908dac893cbcb53cc86e0ecc369aa4def1a29", "US OFAC SDN digital-currency address (ETH), list retrieved 2026-08-06"),
];

/**
 * Known-good: 17 addresses. Base tx counts in the notes are the
 * base.blockscout.com counters measured at assembly (2026-08-06) — recorded
 * so a future reviewer can see each entry passed the has-Base-activity rule.
 */
const KNOWN_GOOD: BenchmarkEntry[] = [
  good(
    "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
    "public_figure",
    "ENS primary name (on-chain): vitalik.eth",
    "https://app.ens.domains/vitalik.eth",
    "Vitalik Buterin's long-standing personal address; 36k+ Base txs at assembly",
  ),
  good(
    "0xde0b295669a9fd93d5f28d9ec85e40f4cb697bae",
    "foundation_treasury",
    "Ethereum Foundation (official EF reports / long-documented EthDev address)",
    "https://ethereum.org/en/foundation/",
    "EF's publicly documented address since 2015; 154 Base txs at assembly",
  ),
  good(
    "0xf977814e90da44bfa03b6295a0616a897441acec",
    "exchange_operational",
    "Binance proof-of-reserves wallet disclosure (2022-11)",
    "https://www.binance.com/en/proof-of-reserves",
    "Binance-disclosed cold wallet; 705 Base txs at assembly",
  ),
  good(
    "0x28c6c06298d514db089934071355e5743bf21d60",
    "exchange_operational",
    "Binance proof-of-reserves wallet disclosure (2022-11)",
    "https://www.binance.com/en/proof-of-reserves",
    "Binance 14 hot wallet; 115 Base txs at assembly",
  ),
  good(
    "0x21a31ee1afc51d94c2efccaa2092ad1028285549",
    "exchange_operational",
    "Binance proof-of-reserves wallet disclosure (2022-11)",
    "https://www.binance.com/en/proof-of-reserves",
    "Binance 15 hot wallet; 81 Base txs at assembly",
  ),
  good(
    "0xdfd5293d8e347dfe59e90efd55b2956a1343963d",
    "exchange_operational",
    "Binance proof-of-reserves wallet disclosure (2022-11)",
    "https://www.binance.com/en/proof-of-reserves",
    "Binance 16 hot wallet; 81 Base txs at assembly",
  ),
  good(
    "0x56eddb7aa87536c09ccc2793473599fd21a8b17f",
    "exchange_operational",
    "Binance proof-of-reserves wallet disclosure (2022-11)",
    "https://www.binance.com/en/proof-of-reserves",
    "Binance 17 hot wallet; 26 Base txs at assembly",
  ),
  good(
    "0x9696f59e4d72e237be84ffd425dcad154bf96976",
    "exchange_operational",
    "Binance proof-of-reserves wallet disclosure (2022-11)",
    "https://www.binance.com/en/proof-of-reserves",
    "Binance 18 hot wallet; 19 Base txs at assembly",
  ),
  good(
    "0x3304e22ddaa22bcdc5fca2269b418046ae7b566a",
    "exchange_operational",
    "Public label consensus (Etherscan/Blockscout community tags): Coinbase",
    "https://base.blockscout.com/address/0x3304E22DDaa22bCdC5fCa2269b418046aE7b566A",
    "Coinbase operational hot wallet; 7.7M Base txs at assembly",
  ),
  good(
    "0x71660c4005ba85c37ccec55d0c4493e66fe775d3",
    "exchange_operational",
    "Public label consensus (Etherscan/Blockscout community tags): Coinbase 1",
    "https://etherscan.io/address/0x71660c4005ba85c37ccec55d0c4493e66fe775d3",
    "Coinbase 1 hot wallet, operating since 2016; 20 Base txs at assembly",
  ),
  good(
    "0x503828976d22510aad0201ac7ec88293211d23da",
    "exchange_operational",
    "Public label consensus (Etherscan/Blockscout community tags): Coinbase 2",
    "https://etherscan.io/address/0x503828976d22510aad0201ac7ec88293211d23da",
    "Coinbase 2 hot wallet; 8 Base txs at assembly",
  ),
  good(
    "0xddfabcdc4d8ffc6d5beaf154f18b778f892a0740",
    "exchange_operational",
    "Public label consensus (Etherscan/Blockscout community tags): Coinbase 3",
    "https://etherscan.io/address/0xddfabcdc4d8ffc6d5beaf154f18b778f892a0740",
    "Coinbase 3 hot wallet; 8 Base txs at assembly",
  ),
  good(
    "0x3cd751e6b0078be393132286c442345e5dc49699",
    "exchange_operational",
    "Public label consensus (Etherscan/Blockscout community tags): Coinbase 4",
    "https://etherscan.io/address/0x3cd751e6b0078be393132286c442345e5dc49699",
    "Coinbase 4 hot wallet; 12 Base txs at assembly",
  ),
  good(
    "0x267be1c1d684f78cb4f6a176c4911b741e4ffdc0",
    "exchange_operational",
    "Public label consensus (Etherscan/Blockscout community tags): Kraken 4",
    "https://etherscan.io/address/0x267be1c1d684f78cb4f6a176c4911b741e4ffdc0",
    "Kraken hot wallet; 18 Base txs at assembly",
  ),
  good(
    "0x2910543af39aba0cd09dbb2d50200b3e800a63d2",
    "exchange_operational",
    "Public label consensus (Etherscan/Blockscout community tags): Kraken",
    "https://etherscan.io/address/0x2910543af39aba0cd09dbb2d50200b3e800a63d2",
    "Kraken hot wallet, operating since 2016; 7 Base txs at assembly",
  ),
  good(
    "0xfe89cc7abb2c4183683ab71653c4cdc9b02d44b7",
    "dao_treasury",
    "ENS DAO documentation (docs.ens.domains): DAO treasury",
    "https://docs.ens.domains/dao",
    "ENS DAO treasury (timelock); 4 Base txs at assembly",
  ),
  good(
    "0xde21f729137c5af1b01d73af1dc21effa2b8a0d6",
    "public_goods_funding",
    "Gitcoin documentation: Grants matching pool multisig",
    "https://gov.gitcoin.co/",
    "Gitcoin Grants matching pool multisig; 21 Base txs at assembly",
  ),
];

/**
 * Interleaved bad/good so a run cut short by the cron time budget still
 * covers both classes instead of exhausting one before touching the other.
 */
export const BENCHMARK_DATASET: BenchmarkEntry[] = (() => {
  const out: BenchmarkEntry[] = [];
  const max = Math.max(KNOWN_BAD.length, KNOWN_GOOD.length);
  for (let i = 0; i < max; i++) {
    if (i < KNOWN_BAD.length) out.push(KNOWN_BAD[i]);
    if (i < KNOWN_GOOD.length) out.push(KNOWN_GOOD[i]);
  }
  return out;
})();
