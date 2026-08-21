// ============================================================
// ERC-8004 Validation Registry 書込の dry-run（読み取り専用・2026-08-21 WO#5）。
//
// 何をするか（すべて読むだけ）:
//  1. 本番DB（DATABASE_URL・SELECT のみ）から x402_l1_purchases を読み、
//     registry-hook の分岐を写して「直近N日・1日あたりの書込候補件数」を出す
//  2. Base RPC（eth_estimateGas / L1 data fee / 現在の maxFeePerGas）と
//     Blockscout の実送信観測から「1件あたり推定ガス・費用」を出す
//  3. 7日合計と、実費に基づく上限案（丸めない wei）を JSON で出す
//
// 何をしないか（設計で封じる）:
//  - 鍵を読まない・walletClient を作らない・署名しない・送信しない
//  - env を変えない。REGISTRY_WRITES_ENABLED が何であっても読むだけ
//  - DB へ INSERT/UPDATE しない（registry-hook / registry.ts を import しない）
//
// 使い方:
//   DATABASE_URL=postgresql://... npm run registry:dry-run            # 7日
//   DATABASE_URL=... npm run registry:dry-run -- --days 14 --out path.json
//   任意: BASE_RPC_URL / REGISTRY_MAX_FEE_GWEI / BLOCKSCOUT_API_URL
// ============================================================
import * as fs from "node:fs";
import * as path from "node:path";
import { createPublicClient, encodeFunctionData, http, parseAbi, type Address } from "viem";
import { base } from "viem/chains";
import { publicActionsL2 } from "viem/op-stack";
import { sql } from "drizzle-orm";
import { getDb } from "../src/lib/db/client";
import { ERC8004_ADDRESSES } from "../src/lib/chain/config";
import {
  aggregateRegistryCandidates,
  capGweiToWei,
  DEFAULT_MAX_FEE_GWEI,
  estimateWriteCostWei,
  FIXED_FALLBACK_GAS,
  formatWeiAsEth,
  medianBigint,
  recommendCaps,
  selectGasUnits,
  weiToUsd,
  wouldSkipForGasCap,
  type L1PurchaseRowLike,
} from "../src/lib/chain/registry-dryrun";

// registry.ts と同じ ABI 文字列（import すると getDb 経由の書込経路と同居するので、ここは読むだけの複製）。
const validationRegistryAbi = parseAbi([
  "function validationRequest(address validatorAddress, uint256 agentId, string requestURI, bytes32 requestHash) external",
  "function validationResponse(bytes32 requestHash, uint8 response, string responseURI, bytes32 responseHash, string tag) external",
]);

/** 署名しないので鍵は不要。見積もりの from には資金ゼロのダミーを使う（eth_estimateGas は残高を見ない）。 */
const DRY_RUN_FROM: Address = "0x000000000000000000000000000000000000dEaD";
const SAMPLE_AGENT_ID = 1n;
const SAMPLE_EVIDENCE_URI = "https://vet402.com/observatory/e/00000000-0000-0000-0000-000000000000";
const SAMPLE_HASH = `0x${"11".repeat(32)}` as `0x${string}`;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

type RpcEstimate = {
  request_gas: bigint | null;
  request_gas_error: string | null;
  response_gas: bigint | null;
  response_gas_error: string | null;
  request_l1_fee_wei: bigint | null;
  response_l1_fee_wei: bigint | null;
  l1_fee_error: string | null;
  max_fee_per_gas_wei: bigint | null;
  max_priority_fee_per_gas_wei: bigint | null;
  gas_price_wei: bigint | null;
  fees_error: string | null;
  rpc_url_host: string;
};

async function readRpc(): Promise<RpcEstimate> {
  const rpcUrl = process.env.BASE_RPC_URL?.trim() || "https://mainnet.base.org";
  const client = createPublicClient({ chain: base, transport: http(rpcUrl) }).extend(publicActionsL2());
  const reqData = encodeFunctionData({
    abi: validationRegistryAbi,
    functionName: "validationRequest",
    args: [DRY_RUN_FROM, SAMPLE_AGENT_ID, SAMPLE_EVIDENCE_URI, SAMPLE_HASH],
  });
  const resData = encodeFunctionData({
    abi: validationRegistryAbi,
    functionName: "validationResponse",
    args: [SAMPLE_HASH, 100, SAMPLE_EVIDENCE_URI, SAMPLE_HASH, "vet402:l1"],
  });
  const out: RpcEstimate = {
    request_gas: null,
    request_gas_error: null,
    response_gas: null,
    response_gas_error: null,
    request_l1_fee_wei: null,
    response_l1_fee_wei: null,
    l1_fee_error: null,
    max_fee_per_gas_wei: null,
    max_priority_fee_per_gas_wei: null,
    gas_price_wei: null,
    fees_error: null,
    rpc_url_host: new URL(rpcUrl).host,
  };
  const errMsg = (e: unknown) => String((e as Error)?.message ?? e).split("\n").slice(0, 3).join(" | ").slice(0, 400);
  try {
    out.request_gas = await client.estimateGas({ account: DRY_RUN_FROM, to: ERC8004_ADDRESSES.validationRegistry, data: reqData });
  } catch (e) {
    out.request_gas_error = errMsg(e);
  }
  try {
    out.response_gas = await client.estimateGas({ account: DRY_RUN_FROM, to: ERC8004_ADDRESSES.validationRegistry, data: resData });
  } catch (e) {
    out.response_gas_error = errMsg(e);
  }
  try {
    out.request_l1_fee_wei = await client.estimateL1Fee({ account: DRY_RUN_FROM, to: ERC8004_ADDRESSES.validationRegistry, data: reqData });
    out.response_l1_fee_wei = await client.estimateL1Fee({ account: DRY_RUN_FROM, to: ERC8004_ADDRESSES.validationRegistry, data: resData });
  } catch (e) {
    out.l1_fee_error = errMsg(e);
  }
  try {
    const fees = await client.estimateFeesPerGas();
    out.max_fee_per_gas_wei = fees.maxFeePerGas ?? null;
    out.max_priority_fee_per_gas_wei = fees.maxPriorityFeePerGas ?? null;
    out.gas_price_wei = await client.getGasPrice();
  } catch (e) {
    out.fees_error = errMsg(e);
  }
  return out;
}

type Observed = {
  source: string;
  sampled_ok_txs: number;
  request_gas_used_median: bigint | null;
  response_gas_used_median: bigint | null;
  request_fee_wei_median: bigint | null;
  response_fee_wei_median: bigint | null;
  latest_ok_tx_at: string | null;
  error: string | null;
};

async function readObserved(): Promise<Observed> {
  const baseUrl = (process.env.BLOCKSCOUT_API_URL?.trim() || "https://base.blockscout.com/api").replace(/\/$/, "");
  const url = `${baseUrl}/v2/addresses/${ERC8004_ADDRESSES.validationRegistry}/transactions?filter=to`;
  const out: Observed = {
    source: url,
    sampled_ok_txs: 0,
    request_gas_used_median: null,
    response_gas_used_median: null,
    request_fee_wei_median: null,
    response_fee_wei_median: null,
    latest_ok_tx_at: null,
    error: null,
  };
  try {
    const res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`http_${res.status}`);
    const body = (await res.json()) as { items?: { method?: string; gas_used?: string; status?: string; timestamp?: string; fee?: { value?: string } }[] };
    const items = (body.items ?? []).filter((t) => t.status === "ok" && t.gas_used);
    out.sampled_ok_txs = items.length;
    const pick = (m: string, f: (t: (typeof items)[number]) => bigint | null) =>
      medianBigint(items.filter((t) => t.method === m).map(f).filter((v): v is bigint => v !== null));
    out.request_gas_used_median = pick("validationRequest", (t) => BigInt(t.gas_used!));
    out.response_gas_used_median = pick("validationResponse", (t) => BigInt(t.gas_used!));
    out.request_fee_wei_median = pick("validationRequest", (t) => (t.fee?.value ? BigInt(t.fee.value) : null));
    out.response_fee_wei_median = pick("validationResponse", (t) => (t.fee?.value ? BigInt(t.fee.value) : null));
    out.latest_ok_tx_at = items.map((t) => t.timestamp ?? "").sort().at(-1) || null;
  } catch (e) {
    out.error = String((e as Error)?.message ?? e).slice(0, 300);
  }
  return out;
}

async function readEthUsd(): Promise<{ eth_usd: number | null; source: string | null; sources_tried: string[]; fetched_at: string; error: string | null }> {
  // 出所を必ず残す。1本目が落ちても黙って null にせず、2本目まで試してから諦める。
  const sources: { url: string; pick: (body: unknown) => number }[] = [
    {
      url: "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
      pick: (b) => Number((b as { ethereum?: { usd?: number } }).ethereum?.usd),
    },
    {
      url: "https://api.coinbase.com/v2/prices/ETH-USD/spot",
      pick: (b) => Number((b as { data?: { amount?: string } }).data?.amount),
    },
  ];
  const fetched_at = new Date().toISOString();
  const errors: string[] = [];
  for (const s of sources) {
    try {
      const res = await fetch(s.url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`http_${res.status}`);
      const n = s.pick(await res.json());
      if (!Number.isFinite(n) || n <= 0) throw new Error("bad_amount");
      return { eth_usd: n, source: s.url, sources_tried: sources.map((x) => x.url), fetched_at, error: errors.join(" ; ") || null };
    } catch (e) {
      errors.push(`${new URL(s.url).host}: ${String((e as Error)?.message ?? e).slice(0, 120)}`);
    }
  }
  return { eth_usd: null, source: null, sources_tried: sources.map((x) => x.url), fetched_at, error: errors.join(" ; ") };
}

type DbRead = {
  db_name: string | null;
  rows: L1PurchaseRowLike[];
  window_status_breakdown: Record<string, number>;
  registry_writes: {
    total: number;
    by_status: Record<string, number>;
    first_created_at: string | null;
    last_created_at: string | null;
    with_tx_hash: number;
    distinct_agent_ids: string[];
  };
  indexed_agent_wallets: Set<string>;
  distinct_evm_payees_in_window: number;
};

async function readDb(windowStart: Date): Promise<DbRead> {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL not configured");
  const unwrap = <T,>(r: unknown): T[] => (Array.isArray(r) ? r : ((r as { rows?: T[] }).rows ?? [])) as T[];

  const dbName = unwrap<{ db: string }>(await db.execute(sql`SELECT current_database() AS db`))[0]?.db ?? null;

  // hook が呼ばれる終局3状態は全期間（重複判定のため）。それ以外は窓内だけ件数を数える。
  const outcomeRows = unwrap<{ endpoint_id: string; status: string; pay_to: string | null; attempted_at: string | Date }>(
    await db.execute(sql`
      SELECT endpoint_id, status, pay_to, attempted_at
      FROM x402_l1_purchases
      WHERE status IN ('settled', 'settle_failed', 'delivered_no_receipt')
      ORDER BY attempted_at ASC
    `),
  );
  const otherRows = unwrap<{ endpoint_id: string; status: string; pay_to: string | null; attempted_at: string | Date }>(
    await db.execute(sql`
      SELECT endpoint_id, status, pay_to, attempted_at
      FROM x402_l1_purchases
      WHERE attempted_at >= ${windowStart.toISOString()}::timestamptz
        AND status NOT IN ('settled', 'settle_failed', 'delivered_no_receipt')
    `),
  );
  const toRow = (r: (typeof outcomeRows)[number]): L1PurchaseRowLike => ({
    endpointId: r.endpoint_id,
    status: r.status,
    payTo: r.pay_to,
    attemptedAt: new Date(r.attempted_at),
  });
  const rows = [...outcomeRows, ...otherRows].map(toRow);

  const window_status_breakdown: Record<string, number> = {};
  for (const r of rows) {
    if (r.attemptedAt >= windowStart) window_status_breakdown[r.status] = (window_status_breakdown[r.status] ?? 0) + 1;
  }

  const rw = unwrap<{ status: string; n: string | number }>(
    await db.execute(sql`SELECT status, COUNT(*)::int AS n FROM registry_writes GROUP BY status`),
  );
  const by_status: Record<string, number> = {};
  let total = 0;
  for (const r of rw) {
    by_status[r.status] = Number(r.n);
    total += Number(r.n);
  }
  const rwMeta = unwrap<{ first: string | Date | null; last: string | Date | null; with_tx: number; agents: string[] | null }>(
    await db.execute(sql`
      SELECT min(created_at) AS first, max(created_at) AS last,
             COUNT(tx_hash)::int AS with_tx,
             array_agg(DISTINCT agent_id) AS agents
      FROM registry_writes
    `),
  )[0];

  const payees = [...new Set(
    rows
      .filter((r) => r.attemptedAt >= windowStart && r.payTo && /^0x[0-9a-fA-F]{40}$/.test(r.payTo))
      .map((r) => r.payTo!.toLowerCase()),
  )];
  const indexed = new Set<string>();
  if (payees.length > 0) {
    const hits = unwrap<{ w: string }>(
      await db.execute(sql`
        SELECT lower(wallet) AS w FROM agents WHERE lower(wallet) IN ${payees}
        UNION
        SELECT lower(owner) AS w FROM owner_agents WHERE lower(owner) IN ${payees}
      `),
    );
    for (const h of hits) if (h.w) indexed.add(h.w);
  }

  return {
    db_name: dbName,
    rows,
    window_status_breakdown,
    registry_writes: {
      total,
      by_status,
      first_created_at: rwMeta?.first ? new Date(rwMeta.first).toISOString() : null,
      last_created_at: rwMeta?.last ? new Date(rwMeta.last).toISOString() : null,
      with_tx_hash: Number(rwMeta?.with_tx ?? 0),
      distinct_agent_ids: rwMeta?.agents ?? [],
    },
    indexed_agent_wallets: indexed,
    distinct_evm_payees_in_window: payees.length,
  };
}

function jsonReplacer(_k: string, v: unknown) {
  return typeof v === "bigint" ? v.toString() : v;
}

async function main() {
  const days = Number(arg("days") ?? 7);
  if (!Number.isInteger(days) || days <= 0) throw new Error("--days must be a positive integer");
  const now = new Date();
  const windowEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)); // 今日(UTC)を含む
  const windowStart = new Date(windowEnd.getTime() - days * 86_400_000);
  const capEnv = process.env.REGISTRY_MAX_FEE_GWEI;
  const capGwei = Number(capEnv ?? DEFAULT_MAX_FEE_GWEI);

  const [dbRead, rpc, observed, ethUsd] = await Promise.all([readDb(windowStart), readRpc(), readObserved(), readEthUsd()]);

  const agg = aggregateRegistryCandidates(dbRead.rows, {
    windowStart,
    windowEnd,
    indexedAgentWallets: dbRead.indexed_agent_wallets,
  });

  const reqGas = selectGasUnits({
    estimated: rpc.request_gas,
    observedMedian: observed.request_gas_used_median,
    fixed: FIXED_FALLBACK_GAS.validationRequest,
  });
  const resGas = selectGasUnits({
    estimated: rpc.response_gas,
    observedMedian: observed.response_gas_used_median,
    fixed: FIXED_FALLBACK_GAS.validationResponse,
  });
  const l1Req = rpc.request_l1_fee_wei ?? 0n;
  const l1Res = rpc.response_l1_fee_wei ?? 0n;
  const l1Source = rpc.l1_fee_error ? "unavailable_counted_as_zero" : "GasPriceOracle.getL1Fee";

  const nowFee = rpc.max_fee_per_gas_wei ?? rpc.gas_price_wei ?? null;
  const capWei = capGweiToWei(capGwei);
  const perWriteAtCap = estimateWriteCostWei({
    requestGas: reqGas.units,
    responseGas: resGas.units,
    feePerGasWei: capWei,
    requestL1FeeWei: l1Req,
    responseL1FeeWei: l1Res,
  });
  const perWriteNow = nowFee === null
    ? null
    : estimateWriteCostWei({
        requestGas: reqGas.units,
        responseGas: resGas.units,
        feePerGasWei: nowFee,
        requestL1FeeWei: l1Req,
        responseL1FeeWei: l1Res,
      });

  const n7 = BigInt(agg.in_window.unique_new_writes);
  const total7AtCap = n7 * perWriteAtCap.total_wei;
  const total7Now = perWriteNow ? n7 * perWriteNow.total_wei : null;
  const hookCallsTotalAtCap = BigInt(agg.in_window.hook_calls) * perWriteAtCap.total_wei; // 重複ゲートが無かった場合の上限

  const caps = recommendCaps({
    maxUniqueNewWritesPerDay: agg.in_window.max_unique_new_writes_per_day,
    perWriteAtCapWei: perWriteAtCap.total_wei,
    perWriteNowWei: perWriteNow?.total_wei ?? 0n,
    capGwei,
  });

  const usd = (wei: bigint | null) => (wei === null ? null : weiToUsd(wei, ethUsd.eth_usd));
  const eth = (wei: bigint | null) => (wei === null ? null : formatWeiAsEth(wei));

  const report = {
    generated_at: now.toISOString(),
    mode: "dry-run (read-only: no key loaded, no tx signed or sent, no env changed, no DB write)",
    registry_writes_enabled_env: process.env.REGISTRY_WRITES_ENABLED === "true",
    database: {
      name: dbRead.db_name,
      registry_writes_ledger: dbRead.registry_writes,
      note: "registry_writes_enabled_env はこのプロセスの env。台帳に行があれば、別の環境（例: Vercel Production）でフラグがONの証拠になる",
    },
    window: agg.window,
    candidates: {
      ...agg.in_window,
      window_status_breakdown: dbRead.window_status_breakdown,
      distinct_evm_payees_in_window: dbRead.distinct_evm_payees_in_window,
      distinct_evm_payees_with_indexed_agent: dbRead.indexed_agent_wallets.size,
      days: agg.days,
      assumptions: agg.assumptions,
      note: "unique_new_writes = requestHash が初出の (endpoint, verdict)。registry_writes が空なら実際に送られる件数に一致。agent解決（resolveAgentIdByWallet）に失敗する payTo は hook が no_agent で退くので実数はさらに小さい（with_indexed_agent が索引ベースの目安）。",
    },
    gas_per_write: {
      chain: "base (eip155:8453)",
      rpc_url_host: rpc.rpc_url_host,
      validation_request: { gas_units: reqGas.units, source: reqGas.source, estimate_error: rpc.request_gas_error },
      validation_response: { gas_units: resGas.units, source: resGas.source, estimate_error: rpc.response_gas_error },
      gas_units_total: perWriteAtCap.gas_units_total,
      l1_data_fee_wei: { request: l1Req, response: l1Res, total: l1Req + l1Res, source: l1Source, error: rpc.l1_fee_error },
      fee_per_gas: {
        cap_env_REGISTRY_MAX_FEE_GWEI: capEnv ?? null,
        cap_gwei_effective: capGwei,
        cap_wei: capWei,
        current_max_fee_per_gas_wei: rpc.max_fee_per_gas_wei,
        current_max_priority_fee_per_gas_wei: rpc.max_priority_fee_per_gas_wei,
        current_gas_price_wei: rpc.gas_price_wei,
        fees_error: rpc.fees_error,
        would_skip_for_gas_cap_now: nowFee === null ? null : wouldSkipForGasCap(nowFee, capEnv),
      },
      per_write_at_cap: { ...perWriteAtCap, total_eth: eth(perWriteAtCap.total_wei), total_usd: usd(perWriteAtCap.total_wei) },
      per_write_at_current_fee: perWriteNow
        ? { ...perWriteNow, total_eth: eth(perWriteNow.total_wei), total_usd: usd(perWriteNow.total_wei) }
        : null,
      observed_onchain: {
        ...observed,
        per_write_fee_wei_median_sum:
          observed.request_fee_wei_median !== null && observed.response_fee_wei_median !== null
            ? observed.request_fee_wei_median + observed.response_fee_wei_median
            : null,
      },
    },
    totals_window: {
      unique_new_writes: agg.in_window.unique_new_writes,
      total_wei_at_cap: total7AtCap,
      total_eth_at_cap: eth(total7AtCap),
      total_usd_at_cap: usd(total7AtCap),
      total_wei_at_current_fee: total7Now,
      total_eth_at_current_fee: eth(total7Now),
      total_usd_at_current_fee: usd(total7Now),
      upper_bound_if_no_dedupe_wei_at_cap: hookCallsTotalAtCap,
      upper_bound_if_no_dedupe_eth_at_cap: eth(hookCallsTotalAtCap),
    },
    recommended_caps: {
      ...caps,
      daily_gas_budget_eth_at_cap: eth(caps.daily_gas_budget_wei_at_cap),
      daily_gas_budget_usd_at_cap: usd(caps.daily_gas_budget_wei_at_cap),
      monthly_30d_gas_budget_eth_at_cap: eth(caps.monthly_30d_gas_budget_wei_at_cap),
      monthly_30d_gas_budget_usd_at_cap: usd(caps.monthly_30d_gas_budget_wei_at_cap),
      basis: "最大日次 unique_new_writes × 1件費用(cap gwei・L1データ込み)。件数0なら予算0。",
    },
    fx: ethUsd,
    fail_closed: {
      flag_off_default: "REGISTRY_WRITES_ENABLED !== 'true' → hook は env を1つ読んで即 return（DB/RPC/鍵に触れない）",
      key_missing: "フラグONでも REGISTRY_OPERATOR_PRIVATE_KEY が無ければ key_missing で退く（agent解決・RPCの前）",
      not_evm: "Solana/不正 payTo → not_evm",
      no_agent: "payTo が ERC-8004 agent に解決できなければ no_agent（書かない）",
      gas_over_cap: `maxFeePerGas > REGISTRY_MAX_FEE_GWEI(${capGwei} gwei) → gas_over_cap（台帳行も作らない）`,
      duplicate: "同じ requestHash は ON CONFLICT DO NOTHING → duplicate（チェーン呼び出しゼロ）",
      send_failure: "writeContract が投げたら台帳 status=failed にして failed を返す。viem は gas 未指定時に eth_estimateGas で先に simulate するので revert する tx は送信前に落ちる（ガス消費ゼロ）",
      hook_never_throws: "fireL1RegistryHook は .catch で logServerError に落とす。購入の記帳には影響しない",
      observed_in_this_run: {
        ledger_rows_total: dbRead.registry_writes.total,
        ledger_rows_imply_writes_were_attempted_somewhere:
          dbRead.registry_writes.total > 0
            ? "registry_writes に行がある＝フラグON＋鍵あり＋agent解決済みの環境で publishValidation が走った（status=failed・tx_hash無し なら送信前に落ちた可能性が高い。Blockscout で当該日の送信有無を必ず突き合わせる）"
            : "registry_writes は空（どの環境でも書込は試行されていない）",
        validation_request_estimate_reverts: rpc.request_gas_error !== null,
        validation_request_estimate_error: rpc.request_gas_error,
        validation_response_estimate_reverts: rpc.response_gas_error !== null,
        validation_response_estimate_error: rpc.response_gas_error,
      },
    },
    units: "wei は10進文字列（丸めなし）。eth は18桁固定小数。usd は fx.source の spot × eth（概算）。",
  };

  const json = JSON.stringify(report, jsonReplacer, 2);
  const outPath = arg("out");
  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, json + "\n");
  }
  console.log(json);
  const fmtUsd = (v: number | null) => (v === null ? "n/a" : `$${v}`);
  console.log(
    `\n[registry:dry-run] ${days}日: hook呼出 ${agg.in_window.hook_calls}件 / 実書込候補(初出hash) ${agg.in_window.unique_new_writes}件 ` +
      `(最大 ${agg.in_window.max_unique_new_writes_per_day}件/日・索引済みagent ${agg.in_window.unique_new_writes_with_indexed_agent ?? "n/a"}件) | ` +
      `1件 ${formatWeiAsEth(perWriteAtCap.total_wei)} ETH @cap ${capGwei}gwei (${fmtUsd(usd(perWriteAtCap.total_wei))}; gas ${perWriteAtCap.gas_units_total} [${reqGas.source}/${resGas.source}]) | ` +
      `${days}日合計 ${formatWeiAsEth(total7AtCap)} ETH (${fmtUsd(usd(total7AtCap))}) | ` +
      `writes_enabled=${report.registry_writes_enabled_env} ledger=${dbRead.registry_writes.total}行 | ` +
      `estimateGas request=${rpc.request_gas_error ? "REVERT" : "ok"} response=${rpc.response_gas_error ? "REVERT" : "ok"}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[registry:dry-run] fatal:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
