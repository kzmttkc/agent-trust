---
title: "x402の『払った』は信用じゃない — ERC-8004信頼スコア Vouch を作った"
emoji: "🔏"
type: "tech"
topics: ["AI", "Web3", "TypeScript", "API"]
published: false
---

# x402の「払った」は信用じゃない — ERC-8004信頼スコア Vouch を作った

**支払いが証明するのは「誰が払ったか」だけです。**  
**「その相手に有料APIを出してよいか」は別問題です。**

x402 API を提供していると、このギャップがそのまま事業リスクになります。ERC-8004 はオンチェーンの Identity / Reputation を与えますが、生のフィードバックを信用スコアだと思うとシビルに弱い。そこで **Vouch** を作りました。Base 上でエージェントを **0〜100** にスコアし、ゲートウェイが使う **`ALLOW` / `WARN` / `BLOCK`** を返します。

本稿は **クローズドβ** の Build in Public メモです。

## 想定フロー

```
Client → x402 支払い検証 → Vouch 信頼チェック → 本来の有料ルート
                         ↘ 任意で決済証跡を書き戻し
```

1. x402 ミドルウェアが支払いを検証し **payer ウォレット** を得る  
2. `GET /v1/wallets/{payer}/score` で Vouch を照会  
3. `BLOCK` なら高コストなハンドラの前に 403  
4. 通したあと任意で `POST /v1/payments/x402` — 決済履歴が将来のスコアに効く（現状 **10%** 加重）

サンプル: リポジトリの `examples/x402-trust-gate`

## スコアの中身（現時点）

| シグナル | 役割 |
|----------|------|
| ERC-8004 Identity | 登録有無・メタデータ URI の有無 |
| ERC-8004 Reputation | フィードバック量・平均（シビル時は減衰） |
| ウォレット휴리스틱 | 年齢・活動・バーナー・資金元クラスタ |
| 手動 WL/BL | 顧客単位のポリシー（チェーンスコアの後） |
| x402 決済証跡 | ゲート通過後の支払いアテステーション |

目安: **≥70 ALLOW**、**40–69 WARN**、**&lt;40 BLOCK**（ブラックリストやシビル high は BLOCK）。スコアは**参考情報**であり保証・与信ではありません。

インデクサの遅れは `dataCoverage` で返すので、「全部知っているフリ」をしない設計にしています。

## インテグレータ向け API

```bash
# payer ウォレットでスコア（x402 主経路）
curl -H "Authorization: Bearer $VOUCH_API_KEY" \
  https://agent-trust-tawny.vercel.app/api/v1/wallets/0xYOUR_PAYER/score

# 検証済み決済の証跡（txHash で冪等）
curl -X POST -H "Authorization: Bearer $VOUCH_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"wallet":"0xYOUR_PAYER","txHash":"0x...","resource":"/api/premium"}' \
  https://agent-trust-tawny.vercel.app/api/v1/payments/x402
```

agent ID 照会、バッチ、MCP（`check_wallet_trust` / `attest_x402_payment`）、TypeScript SDK（`packages/sdk`）もあります。

## あえて選んだ設計

- ウォレット照合や致命的な RPC 失敗は **フェイルクローズ**（誤 ALLOW より拒否）
- WL でも **シビル high は昇格させない**
- **匿名・無料 API の大解放は凍結**（クローズドβで価値検証）
- x402 加重はまず **10%**（データが溜まってから厚くする）

## クローズドβ

最初の対象は **x402 API 提供者** とエージェントランタイム実装者です。

- プロダクト: [agent-trust-tawny.vercel.app](https://agent-trust-tawny.vercel.app)
- コード / ドキュメント: [github.com/kzmttkc/agent-trust](https://github.com/kzmttkc/agent-trust)
- ガイド: `docs/x402-integration.md`、`docs/mcp-setup.md`、`docs/openapi.yaml`

参加希望は **この記事へのコメント or DM** で「何を作っているか」をください。合う方にキーを送ります（**招待コードは記事に書きません**）。

---

*Next.js / viem / Neon / Base 上の ERC-8004 レジストリ。タグライン: Trust layer for agent commerce.*
