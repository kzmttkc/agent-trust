// ============================================================
// L1 実購入の結果を ERC-8004 Validation Registry へ流す配線（C4）。
//
// 呼び手は l1-runner の購入確定後。**graceful が絶対条件**——ここが何を
// 返そうと投げようと、購入の記帳（正典は x402_l1_purchases）には影響
// させない。フラグOFF（既定）の間は env を1つ読むだけで即帰る。
//
// 書けるのは payTo が ERC-8004 agent に解決できる購入だけ（レジストリの
// 主語は agentId）。解決できない・Solana・フラグOFFは全て no-op。
// 鍵は購入ウォレットと別（REGISTRY_OPERATOR_PRIVATE_KEY）——購入資金と
// ガス資金を同じ鍵に載せない。
// ============================================================
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { resolveAgentIdByWallet } from "./agent-resolver";
import { getPublicClient, isValidAddress } from "./client";
import {
  buildValidationRecord,
  isRegistryWritesEnabled,
  publishValidation,
  type PublishOutcome,
} from "./registry";
import { logServerError } from "@/lib/util/log";

export type L1OutcomeInput = {
  endpointId: string;
  payTo: string | null;
  settled: boolean;
};

export type HookOutcome =
  | PublishOutcome
  | { status: "not_evm" }
  | { status: "no_agent" }
  | { status: "key_missing" };

/**
 * fire-and-forget用の実体。テストは戻り値で分岐を検証する。
 */
export async function publishL1OutcomeToRegistry(input: L1OutcomeInput): Promise<HookOutcome> {
  if (!isRegistryWritesEnabled()) return { status: "disabled" };
  if (!input.payTo || !input.payTo.startsWith("0x") || !isValidAddress(input.payTo)) {
    return { status: "not_evm" };
  }

  const rawPk = process.env.REGISTRY_OPERATOR_PRIVATE_KEY?.trim() ?? "";
  const pk = rawPk.startsWith("0x") ? rawPk : rawPk ? `0x${rawPk}` : "";
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) return { status: "key_missing" };

  const agentId = await resolveAgentIdByWallet(input.payTo);
  if (agentId === null) return { status: "no_agent" };

  const account = privateKeyToAccount(pk as `0x${string}`);
  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http(process.env.BASE_RPC_URL ?? "https://mainnet.base.org"),
  });
  const fees = await getPublicClient().estimateFeesPerGas();

  const record = buildValidationRecord({
    endpointId: input.endpointId,
    agentId,
    level: "l1",
    verdict: input.settled ? "pass" : "fail",
    evidenceUri: `https://vet402.com/observatory/e/${input.endpointId}`,
  });
  return publishValidation({
    record,
    walletClient: walletClient as never,
    currentMaxFeeWei: fees.maxFeePerGas ?? 0n,
  });
}

/** l1-runner から呼ぶ非同期版——絶対に投げない。 */
export function fireL1RegistryHook(input: L1OutcomeInput): void {
  // フラグOFFの通常運転で余計なPromiseすら作らない。
  if (!isRegistryWritesEnabled()) return;
  void publishL1OutcomeToRegistry(input).catch((error) => {
    logServerError("registry.hook", error);
  });
}
