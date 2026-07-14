# エージェント信頼スコアリング API — 要件定義書 v0.1

| 項目 | 内容 |
|---|---|
| ドキュメント版 | v0.1 |
| 作成日 | 2026-07-12 |
| ステータス | Draft（ヒアリング反映済み） |
| 開発体制 | ソロ開発（案6単独 → 将来案9連携） |

---

## 1. エグゼクティブサマリー

本プロダクトは、**エージェントコマースにおける信頼インフラ**である。ERC-8004（Trustless Agents）を基盤に、AIエージェントの信頼度を 0〜100 でスコアリングし、API・MCP 経由で提供する。最初のペイング顧客は **x402 API 提供者**とし、有料 API を叩く前のエージェント信頼性検証を最優先ユースケースとする。

将来（Phase 2）では、オンチェーン安全ゲートウェイ（案9）を同一エージェント ID 空間に統合する。

---

## 2. プロダクトビジョン

### 2.1 一言定義

> **エージェントコマースの信頼インフラ** — AIエージェントの信用をスコア化し、支払い・API利用の前に信頼判断を可能にする（将来は安全チェックも統合）。

### 2.2 解決する課題

- x402 / MCP 経済圏で「誰がAPIを叩いているか」が不明確
- ERC-8004 Reputation Registry はシビル脆弱で、単体では実用の信頼判断にならない
- API 提供者が自前でウォレット分析・ブロックリスト管理するコストが高い

### 2.3 提供価値

| 利用者 | 価値 |
|---|---|
| x402 API 提供者 | 不正・使い捨てエージェントの事前排除、API濫用削減 |
| エージェントランタイム | 支払い前の自動信頼チェック（MCP 経由） |
| エコシステム | ERC-8004 エージェントの信頼データ集約レイヤー |

---

## 3. 目標・KPI

### 3.1 リリース方針

- **期限は設けない**（完成度優先）
- パブリック β の品質基準を満たしてから公開

### 3.2 成功指標

| 期間 | KPI |
|---|---|
| リリース後 3ヶ月 | **ERC-8004 登録エージェント 500 体以上**をスコアリング |
| リリース後 6ヶ月 | 有料プラン契約 5社以上（Stretch） |
| リリース後 12ヶ月 | 月間スコア照会 10 万件以上（Stretch） |

---

## 4. スコープ

### 4.1 MVP In Scope（必須）

| # | 機能 | 説明 |
|---|---|---|
| F-01 | 信頼スコア API | 単体・バッチ照会、0〜100 + ALLOW/WARN/BLOCK |
| F-02 | ERC-8004 連携 | Identity / Reputation Registry 読み取り（Base） |
| F-03 | シビル検知（標準） | 複数エージェント検出、レビュー異常、ウォレット年齢、バーナー検出、資金源クラスタ |
| F-04 | ウォレットルックアップ | wallet → agentId 解決（x402 向け） |
| F-05 | 手動 WL/BL | 顧客・運営によるホワイトリスト/ブラックリスト |
| F-06 | 開発者ダッシュボード | APIキー発行、利用量、WL/BL 管理 |
| F-07 | MCP サーバー | `check_agent_trust` 等のツール提供 |
| F-08 | API ドキュメント | OpenAPI + サンプルコード + x402 統合ガイド |
| F-09 | 判定ログ | スコア照会・判定結果の保存（案9連携用） |

### 4.2 MVP Out of Scope（やらないこと）

| 項目 | 理由 |
|---|---|
| オンチェーンスコア書き込み | アルゴリズム反復速度優先 |
| Reputation Registry への書き込み | ガス・法的責任・Phase 2 |
| マルチチェーン対応 | Base 深掘り優先 |
| Gitcoin Passport / World ID 連携 | カバレッジ不足（v1.1 で検討） |
| x402 支払い履歴 | 10%（Phase 1.5） | `POST /v1/payments/x402` 証跡を加重。将来 15–20% |
| グラフ分析・ML シビル検知 | Phase 2 |
| トランザクションシミュレーション（案9） | Phase 2 |
| エンタープライズ SLA / オンプレ | Phase 3 |

---

## 5. ペルソナ・ユースケース

### 5.1 ペルソナ

**P1: x402 API 提供者（Primary）**
- 個人〜スタートアップの開発者
- Base 上で USDC 従量課金 API を運営
- エージェントからの不正呼び出し・使い捨てウォレットを懸念

**P2: エージェントランタイム統合者**
- Cursor / Claude / 自前エージェントフレームワーク利用者
- 支払い前に MCP で信頼チェックを自動化したい

### 5.2 最優先ユースケース（UC-01）

**有料 API 叩く前のエージェント信頼性検証**

```
1. エージェントが x402 API にリクエスト
2. API 提供者ミドルウェアが支払いウォレットを取得
3. 本サービス GET /v1/wallets/{address}/score を呼び出し
4. recommendation が BLOCK → 402 前に拒否
5. WARN → レート制限強化 or 人間承認
6. ALLOW → 通常フロー継続
```

### 5.3 副次ユースケース

- UC-02: 自社エージェントのホワイトリスト登録（誤 BLOCK 回避）
- UC-03: ダッシュボードでエージェント信頼度モニタリング
- UC-04: MCP 経由でエージェント自身が相手先を事前確認

---

## 6. 機能要件

### 6.1 スコア API

#### 6.1.1 レスポンス形式

```json
{
  "agentId": "42",
  "wallet": "0x...",
  "trustScore": 72,
  "recommendation": "ALLOW",
  "signals": {
    "identity": { "registered": true, "metadataValid": true },
    "reputation": { "feedbackCount": 8, "avgScore": 78 },
    "wallet": { "ageDays": 120, "txCount": 340, "isBurner": false },
    "sybil": { "risk": "low", "flags": [] },
    "manual": { "list": "none" }
  },
  "scoredAt": "2026-07-12T12:00:00Z",
  "cacheExpiresAt": "2026-07-12T12:05:00Z"
}
```

| フィールド | 説明 |
|---|---|
| `trustScore` | 0〜100（高いほど信頼） |
| `recommendation` | `ALLOW` (≥70) / `WARN` (40-69) / `BLOCK` (<40 または BL) |
| `signals` | 内訳（デバッグ・透明性用、Pro 以上で詳細） |

#### 6.1.2 エンドポイント（たたき台）

| Method | Path | 説明 |
|---|---|---|
| GET | `/v1/agents/{agentId}/score` | agent ID で照会 |
| GET | `/v1/wallets/{address}/score` | ウォレットで照会（x402 向け） |
| GET | `/v1/agents/{agentId}/score?wallet=` | 照合付き照会（推奨） |
| POST | `/v1/scores/batch` | 最大 50 件バッチ照会 |
| GET | `/v1/agents/{agentId}/history` | スコア履歴（Pro+） |

#### 6.1.3 認証

- **API キー**（`Authorization: Bearer <key>`）
- **プラン別レート制限**（Redis or DB カウンタ）

### 6.2 スコア算出

#### 6.2.1 データソース（MVP）

| ソース | 初期加重 | 備考 |
|---|---|---|
| ERC-8004 Identity | 20% | 登録有無、メタデータ整合性 |
| ERC-8004 Reputation | 30% | フィードバック数・平均（シビル補正後） |
| ウォレット履歴 | 20% | 年齢、TX数、バーナー判定 |
| 手動 WL/BL | 政策レイヤ | WL → floor 80、BL → 0 BLOCK（加重ではなく事後適用） |
| x402 支払い履歴 | 10%（Phase 1.5） | `POST /v1/payments/x402` で蓄積。将来 15–20% |

#### 6.2.2 キャッシュ

- **5 分 TTL**（デフォルト）
- Reputation Registry の `Feedback` イベントで該当 agent のキャッシュ無効化
- 手動 WL/BL 変更時は即時無効化

### 6.3 シビル検知（標準レベル）

| 検知 | 説明 | アクション |
|---|---|---|
| 同一オーナー複数エージェント | 資金源・行動パターンのクラスタ | スコア減点 |
| レビュー速度異常 | 短期間に大量の相互レビュー | レビュー無視 or 減点 |
| 新規バーナー | 作成7日未満 + 低TX | WARN 以上 |
| 資金源クラスタ | 同一ファンディング元から大量ウォレット | スコア減点 |

### 6.4 ホワイトリスト / ブラックリスト

- **顧客単位**の WL/BL（API キーに紐づく）
- **グローバル BL**（運営管理、既知悪性ウォレット）
- WL 登録時: スコア floor 80、`recommendation` 最低 WARN を ALLOW に引き上げ可能
- BL 登録時: 即 BLOCK

### 6.5 ダッシュボード

| 画面 | 機能 |
|---|---|
| 概要 | 今月の照会数、プラン、残枠 |
| API キー | 発行・ローテーション・失効 |
| エージェント検索 | agentId / wallet でスコア確認 |
| WL/BL 管理 | 追加・削除・CSV インポート |
| ログ | 照会履歴（判定・スコア・wallet） |

### 6.6 MCP サーバー

| ツール名 | 説明 |
|---|---|
| `check_agent_trust` | agentId でスコア取得 |
| `check_wallet_trust` | wallet でスコア取得 |
| `explain_trust_score` | スコア内訳の説明 |

---

## 7. 非機能要件

| 項目 | 要件 |
|---|---|
| レイテンシ | p95 < 500ms（キャッシュヒット時 < 100ms） |
| 可用性 | 99.5%（β期間） |
| スループット | 100 req/s（初期） |
| セキュリティ | API キーハッシュ保存、HTTPS 必須 |
| データ保持 | 判定ログ 90 日（Free）/ 1 年（Pro+） |
| 多言語 | API 英語、ダッシュボード英語、ドキュメント日英 |

---

## 8. 技術アーキテクチャ

### 8.1 スタック

| レイヤ | 技術 |
|---|---|
| Frontend / Dashboard | Next.js 15 (App Router) |
| API | Next.js Route Handlers |
| DB | PostgreSQL（Neon or Supabase） |
| Cache | Redis（Upstash）or PG キャッシュテーブル |
| Chain | viem + Base RPC（Alchemy/QuickNode） |
| Indexer | 自前ワーカー（Reputation イベント）or Alchemy webhooks |
| MCP | `@modelcontextprotocol/sdk` |
| Deploy | Vercel |
| Auth | API キー（`api_keys` テーブル） |

### 8.2 対応チェーン

- **MVP: Base mainnet のみ**
- ERC-8004 決定論的デプロイアドレスを使用

### 8.3 識別子設計

- **正規キー**: ERC-8004 agent ID（uint256 token ID）
- **セカンダリ**: wallet address（逆引きインデックス）
- **案9連携用**: `agent_id` を全ログ・将来の安全判定に共通利用

### 8.4 論理構成図

```
[Client / x402 Middleware / MCP Client]
        │
        ▼
[API Gateway — Next.js + Rate Limiter]
        │
        ├──► [Score Engine] ──► [PostgreSQL]
        │         │
        │         ├──► [Cache Layer — 5min TTL]
        │         ├──► [Sybil Detector]
        │         └──► [Base RPC / viem]
        │
        └──► [Dashboard — Next.js UI]
```

---

## 9. データモデル（たたき台）

```sql
-- エージェント
agents (
  agent_id       BIGINT PRIMARY KEY,
  wallet         TEXT,
  chain_id       INT DEFAULT 8453,
  metadata_uri   TEXT,
  last_indexed   TIMESTAMPTZ
)

-- スコアスナップショット
score_snapshots (
  id             UUID PRIMARY KEY,
  agent_id       BIGINT REFERENCES agents,
  trust_score    INT,
  recommendation TEXT,
  signals        JSONB,
  created_at     TIMESTAMPTZ
)

-- 判定ログ（案9連携用）
trust_events (
  id             UUID PRIMARY KEY,
  api_key_id     UUID,
  agent_id       BIGINT,
  wallet         TEXT,
  trust_score    INT,
  recommendation TEXT,
  created_at     TIMESTAMPTZ
)

-- 顧客 API キー
api_keys (
  id             UUID PRIMARY KEY,
  user_id        UUID,
  key_hash       TEXT,
  plan           TEXT DEFAULT 'free',
  created_at     TIMESTAMPTZ
)

-- 顧客別 WL/BL
customer_lists (
  id             UUID PRIMARY KEY,
  api_key_id     UUID,
  wallet         TEXT,
  list_type      TEXT, -- 'whitelist' | 'blacklist'
  created_at     TIMESTAMPTZ
)

-- x402 支払い（Phase 1.5）
x402_payments (
  id             UUID PRIMARY KEY,
  wallet         TEXT NOT NULL,
  amount         TEXT,
  tx_hash        TEXT NOT NULL UNIQUE,
  api_key_id     UUID,
  network        TEXT NOT NULL DEFAULT 'base',
  resource       TEXT,
  created_at     TIMESTAMPTZ
)
```

---

## 10. ビジネスモデル

### 10.1 収益モデル（ハイブリッド）

| プラン | 月額 | 月間照会上限 | 超過単価 |
|---|---|---|---|
| Free | $0 | 1,000 | 不可 |
| Pro | $49 | 50,000 | $0.002/回 |
| Scale | $199 | 500,000 | $0.001/回 |

- Free: クレジットカード不要、APIキー即発行
- Pro/Scale: Stripe 課金

### 10.2 GTM

| チャネル | アクション |
|---|---|
| X | Build in Public、スコア事例・統合デモ |
| GitHub | MCP サーバー + x402 ミドルウェアサンプル OSS |
| エコシステム | x402 Foundation / ERC-8004 コミュニティへの統合紹介 |

### 10.3 市場

- **グローバル公開**（英語）
- **日本向け**: 利用規約・プライバシーポリシー日本語版、確定申告向けFAQ（将来）

---

## 11. 法務・コンプライアンス

### 11.1 スコアの位置づけ

- スコアは**参考情報**であり、保証・投資助言・信用調査ではない（ToS 明記）
- `recommendation` は顧客の最終判断を代替しない

### 11.2 誤判定対応

| 手段 | 内容 |
|---|---|
| 免責 | ToS + API レスポンスに disclaimer |
| ホワイトリスト | 顧客が自社エージェントを自己登録（MVP） |
| 手動レビュー | Scale プラン向け申請フォーム（Phase 2） |

### 11.3 個人情報

- ウォレットアドレスのみ（直接 PII は収集しない）
- 日本個人情報保護法: 仮名加工情報として扱い、プライバシーポリシー整備

---

## 12. Phase 2 拡張（案9 安全ゲートウェイ）

| 項目 | 内容 |
|---|---|
| 共有キー | `agent_id` |
| 共有ログ | `trust_events` → `safety_events` へ拡張 |
| 新機能 | トランザクションシミュレーション、ALLOW/WARN/BLOCK 実行前ゲート |
| 新エンドポイント | `POST /v1/agents/{id}/simulate` |
| データソース加重 | x402 支払い履歴を 10〜20% に |

---

## 13. マイルストーン（推奨・期限なし）

| Phase | 内容 | 目安 |
|---|---|---|
| M0 | リポジトリ、DB、Base RPC 接続、ERC-8004 読み取り | 1〜2 週 |
| M1 | スコアエンジン v0 + シビル標準 + キャッシュ | 2〜3 週 |
| M2 | REST API + APIキー + レート制限 | 1〜2 週 |
| M3 | ダッシュボード + WL/BL | 2 週 |
| M4 | MCP サーバー + ドキュメント + x402 サンプル | 1〜2 週 |
| M5 | クローズド β（10 ユーザー）→ パブリック β | 2 週 |

---

## 14. リスク・未決事項

| リスク | 影響 | 対策 |
|---|---|---|
| ERC-8004 登録エージェント数不足 | KPI未達 | テストネット + 自社登録エージェントでデモ |
| シビルレビュー汚染 | スコア信頼性低下 | 標準シビル検知 + レビュー重み抑制 |
| x402 競合の内製 | 需要分散 | x402 ミドルウェア特化で差別化 |
| スコア責任 | 法的リスク | 免責 + WL + 参考情報の明確化 |
| RPC コスト | マージン圧迫 | 5 分キャッシュ + イベント駆動無効化 |

### 未決事項

- [ ] プロダクト名・ドメイン
- [ ] `ALLOW/WARN/BLOCK` 閾値の最終値
- [ ] グローバル BL のデータソース（Chainalysis 等は Phase 2）
- [ ] Stripe 価格の最終設定
- [ ] 日本法人の要否

---

## 15. ヒアリング決定事項ログ

| ID | 質問 | 決定 |
|---|---|---|
| Q1 | プロダクト定義 | エージェントコマース信頼インフラ |
| Q2 | MVP必須 | スコアAPI、シビル、ERC-8004、Dashboard、MCP、Docs |
| Q3 | リリース | 期限なし・完成度優先 |
| Q4 | 案9先行設計 | agent_id 共通化 + 判定ログ |
| Q5 | 3ヶ月KPI | ERC-8004 500体スコアリング |
| Q6 | ペイング顧客 | x402 API 提供者 |
| Q7 | 利用者 | API 提供者 + エージェントランタイム |
| Q8 | 最優先UC | 有料API前の信頼検証 |
| Q9 | 市場 | グローバル + 日本法務厚め |
| Q10 | GTM | X + GitHub OSS + エコシステム統合 |
| Q11 | スコア形式 | 0-100 + ALLOW/WARN/BLOCK |
| R1 | データソース | Identity, Reputation, Wallet, Manual (+ x402 schema) |
| R2 | シビル | 標準レベル |
| R3 | 更新方式 | 5分キャッシュ + イベント無効化 |
| R4 | チェーン | Base のみ |
| R5 | 識別子 | agent ID 正規 + wallet ルックアップ |
| R6 | オンチェーン | 書き込みなし |
| R7 | スタック | Next.js + PostgreSQL + Vercel |
| R8 | 認証 | APIキー + レート制限 |
| R9 | 収益 | ハイブリッド（無料枠+月額+超過） |
| R10 | 責任範囲 | 免責 + ホワイトリスト自己登録 |

---

*End of document*
