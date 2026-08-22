#!/usr/bin/env -S npx tsx
// vet402 reproducibility CLI — purchase dry-run (次波②/SPEC20-A6).
// 実際の壁に 402 を取りに行き、本番と同一の accept 選定ゲート
// （Base: selectAccept / Solana: selectSolanaAccept）を通し、
// 「署名するならこの内容」を表示する。**署名も送金も一切しない**。
// 実購入は監査済みの日次ランナー（l1-runner）だけが行う——CLI から
// 資金が動く経路は作らない（このファイルに鍵を読むコードは無い）。
// Usage: npx tsx cli/purchase-dry-run.ts <url> [--method GET|POST]
import { parseChallenge, selectAccept } from "../src/lib/observatory/x402-payer";
import { selectSolanaAccept, SOLANA_MAINNET_CAIP2 } from "../src/lib/observatory/sol402-payer";

async function main() {
  const url = process.argv[2];
  if (!url || url.startsWith("--")) {
    console.error("usage: npx tsx cli/purchase-dry-run.ts <url> [--method GET|POST]");
    process.exit(2);
  }
  const mi = process.argv.indexOf("--method");
  const method = (mi >= 0 ? process.argv[mi + 1] : "GET").toUpperCase();
  const res = await fetch(url, {
    method,
    headers: { accept: "application/json", "user-agent": "vet402-cli-dry-run/1.0 (+https://vet402.com/observatory/methodology)", ...(method === "POST" ? { "content-type": "application/json" } : {}) },
    ...(method === "POST" ? { body: "{}" } : {}),
  });
  const bodyText = (await res.text()).slice(0, 16_000);
  if (res.status !== 402) {
    console.log(JSON.stringify({ wouldSign: false, reason: "no_402", httpStatus: res.status }, null, 1));
    return;
  }
  const challenge = parseChallenge({ bodyText, headers: res.headers });
  if (!challenge) {
    console.log(JSON.stringify({ wouldSign: false, reason: "unparseable_challenge" }, null, 1));
    return;
  }
  // CLI は URL しか受け取らないのでカタログ申告値（price / payTo）を持たない。
  // 本番ランナーは両方を突合するため、この dry-run は「申告なし」の場合の判定を
  // 再現している——payto_mismatch / price_mismatch はここでは発火しない（下の note に明示）。
  const base = selectAccept(challenge.accepts, { declaredAmount: null, declaredPayTo: null });
  const sol = selectSolanaAccept(challenge.accepts, { declaredAmount: null, declaredPayTo: null });
  const chosen = base.accept ?? sol.accept;
  console.log(JSON.stringify({
    wouldSign: chosen !== null,
    chain: base.accept ? "eip155:8453" : sol.accept ? SOLANA_MAINNET_CAIP2 : null,
    refusalReasons: chosen ? null : { base: base.reason, solana: sol.reason },
    wouldSignExactly: chosen
      ? { scheme: chosen.scheme, network: chosen.network, amountUnits: chosen.amount, asset: chosen.asset, payTo: chosen.payTo }
      : null,
    note: "Dry-run only. Nothing was signed; no keys are read by this CLI. Live purchases run only inside the audited daily runner. This CLI has no catalog record, so the declared-amount and declared-payTo checks the daily runner applies (price_mismatch / payto_mismatch) are NOT exercised here.",
  }, null, 1));
}
main().catch((e) => { console.error(String(e)); process.exit(1); });
