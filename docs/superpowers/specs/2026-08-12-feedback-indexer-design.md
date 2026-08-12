# NewFeedback インデクサ設計（2026-08-12）

## 問題

`fetchRecentFeedbackStats` (`src/lib/chain/erc8004.ts`) は同期スコアリング経路上で
7日窓（Base で約302,400ブロック）を `eth_getLogs` で走査する。運用値
`GET_LOGS_CHUNK_BLOCKS=2000` では **約151往復**であり、現行RPCプランのどんな
リクエスト予算にも収まらない。1.5秒のデッドラインで打ち切られ、必ず
`feedback_stats_unavailable` に退行する。

`assessSybilRisk` (`src/lib/scoring/verdict.ts:43`) は任意の `*_unavailable` を
risk="high" に写し、`resolveRecommendation` が high を無条件 BLOCK にする。
結果として**全エージェントが実力に関係なく BLOCK** になる。本番のエージェント1は
49/100 を出しながら BLOCK を返している。

このfail-closedの連鎖は正しい。**弱めてはならない。**直すべきは
「シグナルを取得可能にすること」であって、判定の緩和ではない。

## 方式

インデックス（本体）＋ 境界のみの短い実走査（tail scan）。

```
[coverageStart .. checkpoint]     → DB (feedback_events) から集計。RPC 0回
[checkpoint+1  .. tip]            → 実 eth_getLogs。gap ≤ TAIL_MAX のときだけ
gap > TAIL_MAX / デッドライン超過 → feedback_stats_unavailable（現行どおり）
```

### なぜ「DB単独」にしないか

Vercel Hobby の cron は **1日1回・精度±59分**（[docs](https://vercel.com/docs/cron-jobs/usage-and-pricing) 確認済み、
上限は100本/プロジェクトなので8本目の追加自体は可能）。したがって
インデックスは最大約25時間＝約45,000ブロック遅れうる。DB単独で読むと
7日窓が最大1日ずれ、`recentCount` を**過小**に返す。過小は
`review_velocity_anomaly` の取りこぼし＝fail-open方向であり、許容できない。

ずれを `feedback_index_stale` のようなソフトフラグで開示する案（`owner_index_stale`
の前例あり）も検討したが却下した。`verdict.ts` に

```ts
if (flags.length >= 3) return "high";   // → BLOCK
```

があり、`owner_index_stale` が既に常時点灯しがちな現状でフラグをもう1本足すと
**BLOCK が別ルートで再発する**。境界の差分だけを実走査すれば
`RecentFeedbackStats` の意味は現行と完全に一致し、sybil ロジックにもフラグ集合にも
一切触れずに済む。

### tail scan が「有界」である根拠

- 走査幅は `tip - checkpoint` のみ。日次cron＋±59分精度で最悪約45,000ブロック。
- `TAIL_MAX_BLOCKS = 2日 = 86,400`（余裕を持たせた上限）。運用値の
  2,000ブロック幅で最悪43チャンク、平均は約11チャンク。
- 加えて `TAIL_SCAN_DEADLINE_MS = 2,500` を課す。`SIGNAL_BUDGET_MS = 3,500` の内側。
- 上限超過・期限切れはいずれも例外 → 呼び出し側が `feedback_stats_unavailable`
  に変換する。**「遅い」は必ず「拒否」になる**という既存の契約を守る。

従来の151往復が平均11往復に落ちる。これが 429 の巻き添え（`agent_identity_unavailable`）
を止めた根拠でもある。

## 構成要素

### 1. テーブル `feedback_events`

| 列 | 型 | 意味 |
|---|---|---|
| `agent_id` | bigint | NewFeedback の indexed topic |
| `client_address` | text | 小文字正規化。`uniqueClients` の母集合 |
| `block_number` | bigint | 窓判定はブロック番号で行う（現行と同じ定義） |
| `log_index` | integer | |
| `tx_hash` | text | |
| `chain_id` | bigint | 既定 8453 |
| `indexed_at` | timestamptz | |

一意制約 `(chain_id, tx_hash, log_index)` — 再走査を冪等にする。
検索用 `(chain_id, agent_id, block_number)`。

窓の定義に**タイムスタンプではなくブロック番号**を使うのは、現行実装が
`latestBlock - blocksPerDay * windowDays` で窓を切っているため。意味を
変えないことが最優先。

### 2. チェックポイント

既存 `indexer_checkpoints` を再利用。scope は 2 行:

- `reputation_registry_feedback` — 走査済み最終ブロック（`lastBlock`）
- `reputation_registry_feedback:start` — 被覆開始ブロック（`lastBlock` に格納）

被覆開始を持つ理由: 要求窓がインデックスの被覆範囲より古い場合、DBの
集計は**必ず過小**になる。その場合は DB を使ってはならない。

### 3. インデクサ `src/lib/indexer/feedback-indexer.ts`

`owner-indexer.ts` と同型。初回 `fromBlock` は
**`tip - BOOTSTRAP_BLOCKS`（7.5日＝324,000）**。レジストリ創世
(41,663,783) から遡ると数百万ブロックになり300秒予算に収まらず、しかも
スコアリングが必要とする「直近7日」は範囲の**末尾**に来るため最後まで揃わない。
7.5日から始めれば**1回の実行でスコアリング用の窓が成立する**。

被覆は日々前方に伸び、`RETENTION_BLOCKS`（35日）で剪定して定常化する。

### 4. cron `/api/cron/index-feedback`

`maxDuration = 300`、`authorizeCron`、本番は `maxBlocks` を固定。
`vercel.json` に 8 本目 `0 2 * * *` を追加（Hobby 上限100本に対し8本）。

### 5. 読み取り `src/lib/db/feedback-index.ts`

`getIndexedFeedbackWindow(agentId, fromBlock, chainId)` →
`{ rows, checkpoint, coverageStart } | null`。テーブル未適用のDBでは
`isMissingSchemaError` で `null` を返し、既存の「fallback-tolerantな読み手」
慣行に従う。

### 6. `fetchRecentFeedbackStats` の書き換え

```
tip = getBlockNumber()
fromBlock = tip - blocksPerDay * windowDays   （現行と同一）
index = getIndexedFeedbackWindow(...)
if (!index || index.coverageStart > fromBlock) → 全域チェーン走査（有界化不能なら例外）
gap = tip - index.checkpoint
if (gap > TAIL_MAX_BLOCKS) → throw feedback_stats_unavailable
tailLogs = gap > 0 ? getLogsChunked([checkpoint+1, tip], deadline 2.5s) : []
merge(index.rows, tailLogs) を (txHash, logIndex) で重複排除
→ { recentCount, uniqueClients, windowDays }
```

戻り値の型・フィールド・意味は不変。`sybil.ts` / `verdict.ts` / `helpers.ts` は
**1行も変更しない**。

### 7. `outcome-detector` の扱い

`checkReputationNegativeFeedback` は最大30日の窓で呼ぶ。ブートストラップ直後の
被覆は7.5日なので、要求窓が被覆を超える場合は自動的に全域チェーン走査へ
フォールバックする（cron実行でありリクエスト予算の制約がない）。被覆は
35日で定常化し、以後はDB経路に乗る。

## テスト

`tests/feedback-index.test.ts` — DB非依存の純関数として:

- `resolveWindowFromBlock` — 窓のブロック計算がチェーン別 `blocksPerDay` に従う
- `summarizeFeedback` — 重複排除と `uniqueClients` の大文字小文字非依存
- `canTailScan` — 上限判定の境界値
- 被覆不足時に DB 経路を選ばないこと

## 追記（2026-08-12、本番デプロイ後に判明）

**ライブ側のRPCは `eth_getLogs` を返さない。** 上の設計をデプロイした直後、
本番は再び 49/BLOCK に戻った。ログ:

```
[chunked-logs] bisecting 49851354-49851374 matched=text:block range
  due to: JSON is not a valid request object.
```

680ブロックという極小の正常なクエリである。範囲でもレート制限でもなく、
`BASE_RPC_URL` の口がこのメソッドを受け付けていない。同じ形の要求を
`INDEXER_RPC_URL` の口は345,600ブロック・173チャンクを24.8秒・無失敗で返した。

これが元の障害のもう半分だった。7日走査は往復が多すぎただけでなく、
**そもそもこのメソッドを返さない口に投げられていた**。走査をcronへ移して量は
解決したが、残したtail走査が同じ口を使っていれば同じ理由で失敗する。

対応: `getLogScanClient()` を足し、ログ読み取りは「ログを返す口」へ向ける
（どの経路が要求したかに依らない）。インデクサ用RPCを分けている理由は
*バッチ*の量をライブ側の予算から外すことなので、上限2日・2.5秒・通常1チャンクの
tail読み取りをそこへ乗せても分離の意図は壊れない。

あわせて二分割ガードの漏れを塞いだ。範囲語がecho除去の届かない経路から
matcher に入っていた。どのフィールドかを追うより、「要求が不正／許可されていない
と言われたら範囲を半分にしても答えは変わらない」を数値コードより先に効かせる
（`NEVER_RANGE_PATTERNS`）。

## 運用メモ

本番DBは Neon プロジェクト `vouch-agent-trust` の **`vouch`** データベース。
同一エンドポイントに `postgres` / `neondb` も居る。リポジトリ直下の
`.env.production.local` は `neondb` を指しており本番ではない（owner索引0件、
trust_events最終 2026-08-06）。Vercelの環境変数は全て Sensitive なので
CLI / ダッシュボードのどちらからも読み戻せない。

## 検証

1. `npm run build`
2. `npx tsx --test tests/*.test.ts`
3. 本番DDL適用 → cron手動起動 → 妥当なエージェントが非BLOCKを返すことを確認

実測（2026-08-12）:

| | 修正前 | 修正後 |
|---|---|---|
| エージェント1 | 49 / BLOCK / sybil=high | **83 / ALLOW / sybil=low** |
| deep health | degraded | **ok**（scoring 647ms、feedback_indexer ok） |

ブートストラップ 24.8秒 / 17,578件。日次cronは 02:26 UTC に無人で走り、
18,074件・checkpoint前進を確認（Hobbyの±59分ずれ込み込み）。
シグナルは緩んだのではなく効いている: 56260番（1クライアントから7日で1,492件）は
`review_velocity_anomaly` が発火してWARN、25975番（9クライアントから12,796件）は
健全な高頻度として velocity では落ちない。この判別は今まで一度も動いていなかった。
