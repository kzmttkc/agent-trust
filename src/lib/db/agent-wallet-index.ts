import { eq, sql } from "drizzle-orm";
import type { Address } from "viem";
import { getDb } from "./client";
import { agents, ownerAgents } from "./schema";

/**
 * wallet→agent 索引（2026-08-13）。
 *
 * WHY. `resolveAgentIdByWallet` はこの逆引きを、identity registry の
 * WalletSet / Registered ログを FROM_BLOCK から tip まで走査して作っていた。
 * 本番の運用値で 1 ウォレットあたり約8,200往復——300秒の関数に収まらない量で、
 * 週次ベンチマークはこれで毎回殺されていた。逆引きはチェーン上に存在しないので、
 * 索引を持つ以外に安く答える方法は無い。
 *
 * 二つの経路がある。エージェントの運用ウォレット（WalletSet）は `agents` に、
 * 所有者アドレス（Registered / Transfer）は既存の `owner_agents` に入る。
 * どちらも「候補」でしかなく、確定はオンチェーンの束縛照合が行う——索引が
 * 古くても、間違った答えではなく候補の取りこぼしにしかならない側へ倒してある。
 */

/** 候補 agentId（重複は呼び出し側で潰す）。DB 未設定なら空。 */
export async function findIndexedAgentIdsByWallet(wallet: Address): Promise<bigint[]> {
  const db = getDb();
  if (!db) return [];

  const key = wallet.toLowerCase();

  const [walletRows, ownerRows] = await Promise.all([
    db.select({ agentId: agents.agentId }).from(agents).where(eq(agents.wallet, key)),
    db.select({ agentId: ownerAgents.agentId }).from(ownerAgents).where(eq(ownerAgents.owner, key)),
  ]);

  const ids = new Set<bigint>();
  for (const row of [...walletRows, ...ownerRows]) {
    if (row.agentId !== null && row.agentId !== undefined) ids.add(row.agentId);
  }
  return [...ids];
}

/** 信頼された索引の書き込み経路——ライブのスコアリングからは決して呼ばない。 */
export async function upsertAgentWallet(agentId: bigint, wallet: Address): Promise<void> {
  const db = getDb();
  if (!db) return;

  await db
    .insert(agents)
    .values({ agentId, wallet: wallet.toLowerCase(), lastIndexed: new Date() })
    .onConflictDoUpdate({
      target: agents.agentId,
      set: {
        // 貼り替えは新しい束縛が勝つ。古いウォレットを残すと、他人のアドレスに
        // エージェントの実績が付く。
        wallet: sql`excluded.wallet`,
        lastIndexed: new Date(),
      },
    });
}
