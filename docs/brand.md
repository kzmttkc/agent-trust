# プロダクト名ブレスト

## 推奨名：**Vouch**

| 項目 | 内容 |
|---|---|
| 製品名 | **Vouch** |
| タグライン | *Trust layer for agent commerce* |
| API名 | Vouch Trust API |
| ドメイン候補 | vouch.dev / getvouch.io / vouchlayer.com |
| リポジトリ | `agent-trust`（コードネーム）→ 公開時に `vouch` へリネーム可 |

### 推奨理由

1. **意味が直球** — "vouch for" = 信用を保証する。信頼スコアの本質と一致
2. **短い** — API名、MCPツール名、CLIに載せやすい（`vouch check 0x...`）
3. **動詞にも名詞にもなる** — "Get a Vouch score" / "Vouch this agent"
4. **x402文脈と相性** — 支払い前の信用確認というフローに自然
5. **案9拡張** — Vouch Safety（将来の安全ゲートウェイ）にもブランドを伸ばせる

---

## 候補一覧

| # | 名前 | タグライン案 | 強み | 弱み |
|---|---|---|---|---|
| 1 | **Vouch** ⭐ | Trust layer for agent commerce | 短い・覚えやすい・動詞 | vouch.dev の取得要確認 |
| 2 | Trustline | Credit line for agent trust | 金融っぽい信頼感 | やや長い |
| 3 | Beacon | Signal trust before you pay | 視覚的メタファー | 汎用すぎる |
| 4 | Attest | On-chain attestation for agents | ERC-8004と技術的に一致 | 開発者向けすぎ |
| 5 | Ward | Guard your agent transactions | 案9（安全）とも一致 | 製品名として不明瞭 |
| 6 | Credence | Agent credibility, quantified | 上品 | 発音・綴りの障壁 |
| 7 | Surety | Bonded trust for AI agents | 法的ニュアンス | 堅すぎる |
| 8 | Relay Trust | — | 説明的 | 長い・弱い |
| 9 | AgentGate | Gateway to trusted agents | 機能的 | Gate = 拒否の印象 |
| 10 | Trustlayer | — | 要件定義と一致 | 汎用・ドメイン競合 |

---

## 命名で避けたもの

- **Cred** — Cred Protocol と混同
- **Safe / Guard** — 案9（安全）用に温存
- **Score / Rate** — 汎用すぎ、SEO弱い
- **8004** — 標準番号依存は危険（標準が変わる可能性）

---

## ブランド階層（採用案）

```
Vouch                          … 会社 / プロダクトファミリー
├── Vouch Trust API            … スコアリング API（MVP / 案6）
├── Vouch Safety API           … 安全ゲートウェイ（Phase 2 / 案9）
└── Vouch MCP                  … MCP サーバー統合
```

---

## 次のアクション

- [ ] vouch.dev / getvouch.io のドメイン空き確認
- [ ] GitHub org `vouch-dev` の確保
- [ ] OpenAPI・README の製品名を Vouch に統一（実施済み: openapi.yaml）
