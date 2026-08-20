# vet402 買収級拡張——全提案項目の統合実装計画（2026-08-20夜・ノンストップ）

> REQUIRED SUB-SKILL: superpowers:executing-plans
> 出典: 2026-08-20チャットの3ラウンド提案（10＋5＋12件）を重複統合。

**Goal:** 「①無くなると困る ②作り直せない ③すぐ引き継げる」の3条件を実装で埋め、同時にハッカソン/助成金の残り穴（第三者利用・提出物・実額提案書）を成果物化する。

**承認境界（実装するがONにしない/起票のみ）:** Solana実購入とMemo刻印のON（入金）・ERC-8004書込のON（ガス）・PyPI/npm公開・AgentKit upstream PR提出・外部打診送信。

## 実装順（依存順・各タスクTDD→緑→コミット）

### 私のレーン（コア・逐次）
- **C2 スキーマ一括**: `ledger_anchors`（day PK, root_hash, prev_hash, entry_count, anchored_tx）・`verification_requests`・`disputes`・`waitlist_entries`
- **C3 台帳ハッシュチェーン**（A5/TEE Stage 0）: 日次の l1購入+L0集計を正規化JSON→sha256、prevと連鎖。cron統合（metrics-rollup内）＋`GET /api/v1/observatory/anchors`＋stateページ§に表示。オンチェーンアンカーはflag OFFの書込口だけ用意
- **C4 レジストリ配線**（#2の残り）: L1 settle後フック→payTo→agent解決→publishValidation（既存・flag OFF）。runnerに非同期・graceful接続
- **C5 カバレッジ支配率**（A8）: 「直近7日以内に測定を公開したactive endpoints比率」を state API+ページに追加（分母明示）
- **C6 verify-at-settle 高速判定**（A1）: キー付き `GET /api/v1/payees/{address}/verdict-fast`——事前計算キャッシュ＋ETag、p95実測をテストで固定、SLA文書
- **C7 バックテストAPI**（#9）: 自社845件から「直前に公開failシグナルが存在した支払いの件数/金額」を機械定義で算出・`/api/v1/observatory/backtest`＋方法論
- **C8 紛争フロー**（#8）: payTo署名（EIP-191）付き異議→保存→自動再プローブ→公開。`POST /api/v1/observatory/disputes`
- **C9 検証リクエストキュー**（#5 無償枠）: `POST /api/v1/observatory/requests`→日次cronがL0対象に注入。x402課金枠は将来（self-listing計画と統合）
- **C10 /live SSE**（#6）: 新規プローブ/購入のポーリングSSE（maxDuration 60・自動再接続前提）
- **C11 /operations + /partners + waitlist**（15/11）: AI運営の透明性ページ・デザインパートナー募集・`POST /api/v1/waitlist`（保存のみ・送信なし）
- **C12 Solana Memo刻印 v0**（#3）: 検証record hashをMemo txで刻むモジュール（flag OFF・registry_writes台帳併用・部分＝自署名のみ）
- **C13 Solanaウォレット生成+env投入+入金手番起票**（#1）: 鍵生成→Vercel env（flag OFF）→実費算出（カタログ実価格から）→TODO
- **C14 予測フラグv0**（A6）＋**トラストグラフv0**（A7）: 履歴からの機械的リスクフラグ（**キー付きAPIのみ・観測所ページに出さない＝L3分離厳守**）・payTo↔endpoint↔payer関係API
- 仕上げ: 全テスト・build・db:push（preflight）・デプロイ・本番実測・記帳

### 委任レーン（並行・git操作禁止）
- **A: Python SDK**（#10）: `packages/python-sdk`——TS SDKミラー（fail-closed・401/5xx峻別）・pytest・pyproject。公開はしない
- **B: solana-agent-kit プラグイン**（#4）＋**AgentKit upstream統合ドラフト**（A2）: SendAI実APIを一次裏取り・dry-run実走。upstreamはPR本文+差分案まで
- **C: 文書**: 実額入りSolana助成金提案書（14・実費積算）・CLA.md+IP資産台帳（A10）・ハッカソン提出物スケルトン+絵コンテ（12・Takeshi_Automation側・非公開）

### 実装しない（境界の再確認）
デザインパートナー/Superteamの実接触（外部送信→起票）・外部セキュレビュー実施（AQ-037）・課金開始（経済化関門）・オンチェーンアンカー/刻印/実購入のON
