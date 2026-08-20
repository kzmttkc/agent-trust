#!/usr/bin/env -S npx tsx
// vet402 reproducibility CLI — ledger anchor chain verification (次波②).
// 公開APIだけで、日次rootの連鎖（day N の prevRoot == day N-1 の root）を
// 第三者が検証する。root そのものの再計算には生の購入行が必要
// （self-host か research アクセス）——出来ること/出来ないことは
// cli/README.md に正直に書いてある。
// Usage: npx tsx cli/verify-anchors.ts [--days 30] [--base https://vet402.com]
async function main() {
  const di = process.argv.indexOf("--days");
  const days = di >= 0 ? Number(process.argv[di + 1]) : 30;
  const bi = process.argv.indexOf("--base");
  const base = bi >= 0 ? process.argv[bi + 1] : "https://vet402.com";
  const res = await fetch(`${base}/api/v1/observatory/anchors?days=${days}`);
  const { anchors } = (await res.json()) as { anchors: { day: string; rootHash: string; prevRoot: string | null }[] };
  let ok = true;
  for (let i = 0; i + 1 < anchors.length; i++) {
    const linked = anchors[i].prevRoot === anchors[i + 1].rootHash;
    if (!linked) ok = false;
    console.log(`${anchors[i].day} <- ${anchors[i + 1].day}: ${linked ? "LINKED" : "BROKEN"}`);
  }
  console.log(JSON.stringify({ days: anchors.length, chainIntact: ok }));
  process.exit(ok ? 0 : 1);
}
main().catch((e) => { console.error(String(e)); process.exit(1); });
