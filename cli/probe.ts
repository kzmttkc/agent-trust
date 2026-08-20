#!/usr/bin/env -S npx tsx
// vet402 reproducibility CLI — L0 probe (次波②/SPEC20-A6).
// 誰でも同じ測定を打てる: 本番と同一の probeEndpoint（SSRFガード込み）を
// 1 URL に対して実行し、ProbeResult をそのまま JSON で出す。
// Usage: npx tsx cli/probe.ts <url> [--method GET|POST] [--pay-to 0x..] [--amount 3000] [--asset 0x..] [--network eip155:8453]
import { probeEndpoint } from "../src/lib/observatory/l0-probe";

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

async function main() {
  const url = process.argv[2];
  if (!url || url.startsWith("--")) {
    console.error("usage: npx tsx cli/probe.ts <url> [--method GET] [--pay-to ..] [--amount ..] [--asset ..] [--network ..]");
    process.exit(2);
  }
  const result = await probeEndpoint({
    resourceUrl: url,
    method: (arg("method") ?? "GET").toUpperCase(),
    payTo: arg("pay-to"),
    network: arg("network"),
    priceAmount: arg("amount"),
    priceAsset: arg("asset"),
  });
  console.log(JSON.stringify(result, null, 1));
  process.exit(0);
}
main().catch((e) => { console.error(String(e)); process.exit(1); });
