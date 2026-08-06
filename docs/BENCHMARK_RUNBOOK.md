# Operator benchmark runbook — `npm run benchmark:scan`

/accuracy の「Operator benchmark」節に最初のデータ点を入れるための手順。
**本番 DB へ書き込むため Takeshi 手番**（DATABASE_URL を持つ端末で実行）。

## これは何をするか

固定・バージョン管理された既知アウトカムのアドレス集合（`src/lib/benchmark/dataset.ts`）を
**ライブ検索と同じエンジン・同じ fail-closed ルール**で採点し、判定と地上真実（ground truth）を
`verdict_outcomes` に `source='operator_benchmark'` で記録する。外部の /accuracy 数字とは
クエリレベルで完全分離される（自己シードを外部トラフィックに混ぜない）。

- 既知悪 = 米財務省 OFAC SDN の現行 ETH アドレス（public domain）
- 既知良 = 長期運用・公開帰属・無事故で Base に実活動があるアドレス
- 判定: 既知悪を BLOCK/WARN すれば検知、ALLOW すれば見逃し。既知良を ALLOW すれば正、BLOCK すれば誤検知

方法論の全文は **/accuracy ページの Methodology 節に既に公開済み**（アドレス選定基準・出典・
自己シードの明示・`src/lib/benchmark/dataset.ts` への参照を含む）。この runbook は「動かし方」に限定する。

## 前提（env）

| 変数 | 用途 |
|---|---|
| `DATABASE_URL` | Neon 本番（書き込み先）。**これが無いと何も記録されず終了する** |
| `BASE_RPC_URL`（または `INDEXER_RPC_URL`） | Base RPC。スコアリングのチェーン読み取りに必須 |

## 実行

```bash
cd ~/vouch
npm run benchmark:scan
```

出力（JSON）:

```json
{ "scanned": 42, "recorded": 42, "errors": 0, "skipped": 0, "datasetVersion": 1 }
```

- `recorded == 0` のときスクリプトは **exit 1** で「DATABASE_URL / verdict_outcomes テーブルを確認」と出す
- `skipped > 0` は時間予算（240秒）切れで未着手が残った合図。もう一度流せば残りが入る

## 安全性（スクリプトを読んで確認済み）

- **冪等（リトライ安全）**: `verdict_outcomes` への書き込みは `onConflictDoNothing`
  （unique 制約 `(trust_event_id, outcome_type, source)`）。同一 trust_event の二重記録は起きない
- **fail-safe**: DB 未設定なら採点もせず即 no-op（RPC 枠を無駄にしない）。1件の RPC 失敗は
  per-entry で隔離され、パス全体を止めない。テーブル未マイグレーションはクラッシュせずログ1行に降格
- **本番エンジンを特別扱いしない**: `scoreWallet(address, {})` を空コンテキストで呼ぶだけ。
  顧客リストも特権パスも通らない＝ベンチマークは実運用そのものを測る

**注意（冪等の範囲）**: 各実行は**アドレスごとに新しい採点スナップショット**（新しい `trust_events` 行）を
作る。これは設計通り（週次 cron と同じ挙動で、/accuracy は直近90日を集計する）。
「同じ実行の再試行」は重複しないが、「別日にもう一度流す」と新しいスキャンが1本増える。
短時間に何度も流すとスキャン数が水増しされるので、初回シード + 週次 cron 任せで十分。

## /accuracy に何が出るか

実行後、/accuracy の **「Operator benchmark (labeled addresses)」** 節に:

- **Known-bad detection rate**: 既知悪を BLOCK/WARN できた割合（見逃し件数も併記）
- **Known-good false-positive rate**: 既知良を誤って BLOCK した割合（WARN 件数も併記）
- 直近90日のベンチマークスキャン数と最終実行日
- 外部トラフィックの数字（上段）とは**別枠**で表示され、そこには一切混ざらない

最小サンプルルール（`MIN_SAMPLE=10`）が外部指標と同様に適用され、それ未満のバケットは
数字でなく「insufficient data」と出る。

## 自動化

`vercel.json` の cron で **毎週水曜 09:30 UTC**（`30 9 * * 3`）に `/api/cron/benchmark-scan` が
同じ runner を叩く。手動実行は「初回の1点を水曜まで待たない」ためのもの。地上真実ラベルは
速く動かないので、日次実行は不要（かつプランの cron 上限は日次）。
