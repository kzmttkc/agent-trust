/**
 * wallet→agent 解決の窓算術（2026-08-13）。
 *
 * WHY THIS FILE EXISTS. `resolveAgentIdByWallet` は identity registry を
 * `IDENTITY_REGISTRY_FROM_BLOCK`（41,663,783）から tip まで `eth_getLogs` で
 * 全履歴走査していた。`GET_LOGS_CHUNK_BLOCKS=2000` の運用値では 1 フィルタ
 * 約4,100往復、WalletSet と Registered の 2 本で約8,200往復——**1ウォレット
 * あたり**である。本番で 1 invocation が捌ける実力は約50万ブロック＝250往復
 * （`scripts/catch-up-owner-index.sh` が maxBlocks=500000 で最大200回ループする
 * のはそのため）なので、300秒の関数には 1 件も収まらない。週次の
 * benchmark-scan cron はこれで毎回プラットフォームに殺され、trust_events に
 * 1行も書けないまま沈黙していた（2026-08-13 実測: 本番の benchmark_seed は
 * 史上0行）。
 *
 * 直し方は 2026-08-12 の NewFeedback インデクサと同じ型——索引（DB）が本体、
 * 未索引の境界だけを短く実走査する。ここに置くのはその判断規則だけで、DB も
 * RPC も要らずに評価できる。feedback-window.ts と同じ理由での分離。
 *
 * 守る不変条件: **索引が窓全体を覆えないときは走査せず unavailable を返す。**
 * 解決に失敗した wallet は「エージェントではない」として素のウォレット経路で
 * 採点される——つまり取りこぼしは fail-OPEN（エージェント固有のシグナルが
 * 黙って落ちる）側に倒れる。だから覆えないなら答えないのが正しく、
 * 「上限を超えたら全部走査する」は取ってはいけない選択肢である。
 */

export type AgentResolvePlan =
  | { kind: "indexed_only" }
  | { kind: "tail_scan"; fromBlock: bigint; toBlock: bigint }
  | { kind: "unavailable"; reason: "index_missing" | "index_gap_too_large" };

/**
 * 実走査を許す tail の日数。
 *
 * Hobby の cron は日次・±59分のぶれがあるので、索引は正常でも約25時間ぶん
 * 遅れうる。2日あればそれに加えて 1 回の取りこぼしも吸収できる。これを超えた
 * ものはもう「境界」ではなく、この変更が消しにきた広域走査そのものなので、
 * 走らせずに退行する。
 */
export const AGENT_RESOLVE_TAIL_MAX_DAYS = 2;

export function agentResolveTailMaxBlocks(blocksPerDay: number): bigint {
  return BigInt(Math.ceil(AGENT_RESOLVE_TAIL_MAX_DAYS * blocksPerDay));
}

/**
 * 索引の到達点と tip から、実走査すべき区間を決める。
 *
 * `checkpoint` は「この位置までは DB が答えを持っている」という意味であり、
 * 索引は常に `IDENTITY_REGISTRY_FROM_BLOCK` から前進するので、
 * `[FROM_BLOCK .. checkpoint]` の被覆はチェックポイントの存在そのものが保証する。
 */
export function planAgentResolveScan(input: {
  checkpoint: bigint | null;
  tip: bigint;
  maxTailBlocks: bigint;
}): AgentResolvePlan {
  const { checkpoint, tip, maxTailBlocks } = input;

  // 索引が一度も走っていない＝DBは何も知らない。ここで全履歴走査へ落ちるのが
  // 元の欠陥だった。
  if (checkpoint === null) return { kind: "unavailable", reason: "index_missing" };

  const gap = tip - checkpoint;
  if (gap <= 0n) return { kind: "indexed_only" };
  if (gap > maxTailBlocks) return { kind: "unavailable", reason: "index_gap_too_large" };

  return { kind: "tail_scan", fromBlock: checkpoint + 1n, toBlock: tip };
}
