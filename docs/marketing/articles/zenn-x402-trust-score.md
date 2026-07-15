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

そしてこのリスクは片側だけの話ではありません。**支払う側のエージェント**にも鏡写しの問題があります。402 の向こうにいるウォレットは本物のサービスなのか、USDC を受け取って消えるバーナーなのか。そこで Vouch は**売り手・買い手の両面**をスコアするようにしました。

本稿は **クローズドβ** の Build in Public メモです。

## 想定フロー

```
売り手側 — この payer にサービスを出してよいか？
Client → x402 支払い検証 → Vouch payer チェック → 本来の有料ルート
                         ↘ 任意で決済証跡を書き戻し

買い手側 — このウォレットに支払ってよいか？
自分のエージェント → Vouch payee チェック → x402 支払い → 相手の API
```

売り手側:

1. x402 ミドルウェアが支払いを検証し **payer ウォレット** を得る  
2. `GET /v1/wallets/{payer}/score` で Vouch を照会  
3. `BLOCK` なら高コストなハンドラの前に 403  
4. 通したあと任意で `POST /v1/payments/x402` — 決済履歴が将来のスコアに効く（現状 **10%** 加重）

買い手側:

1. エージェントが 402 を受け、支払い要求から **payee ウォレット** を得る  
2. 署名する前に `GET /v1/payees/{payee}` を照会  
3. `BLOCK` なら支払わない。`WARN` なら金額上限や人間の確認など自前のポリシーで判断

サンプル（売り手側ミドルウェア）: リポジトリの `examples/x402-trust-gate`

## payer スコアの中身（現時点）

| シグナル | 役割 |
|----------|------|
| ERC-8004 Identity | 登録有無・メタデータ URI の有無 |
| ERC-8004 Reputation | フィードバック量・平均（シビル時は減衰） |
| ウォレットヒューリスティック | 年齢・活動・バーナー・資金元クラスタ |
| 手動 WL/BL | 顧客単位のポリシー（チェーンスコアの後） |
| x402 決済証跡 | ゲート通過後の支払いアテステーション |

目安: **≥70 ALLOW**、**40–69 WARN**、**&lt;40 BLOCK**（ブラックリストやシビル high は BLOCK）。スコアは**参考情報**であり保証・与信ではありません。

インデクサの遅れは `dataCoverage` で返すので、「全部知っているフリ」をしない設計にしています。

## 今週追加: Payee Trust API（買い手側）

`GET /v1/payees/{address}` は買い手側の問いに答えます。payee の失敗モードはシビルなフィードバックではなく「受け取って消える」ことなので、シグナル構成を変えています。

| シグナル | 役割 |
|----------|------|
| 受け取り履歴 | このウォレットが payee だった x402 決済証跡 — 件数・活動日数・支払い元の数 |
| ウォレット健全性 | payer スコアと同じ年齢・tx 数・バーナー判定 |
| ドレインパターン | 出口詐欺の形（受け取った資金をほぼ全部引き抜く）を native ETH と Base USDC の両方で判定。ガス残渣で誤検知しないようダスト下限つき |
| アウトカム履歴 | このウォレットに紐づく確定詐欺 / 確定正当のラベル |

設計上のポイントは2つ:

- **404 を返しません。** 誰もアテステーションしていないウォレットでも `200` と `dataDepth: "thin"` を返し、加重が自動で変わります。データが薄い（thin）ウォレットはウォレット健全性とドレイン形状で、履歴が厚い（rich）ウォレットは受け取り実績で主に判定。薄いスコアをどこまで信じるかはインテグレータが決められます。
- **データループは共有。** `POST /v1/payments/x402` のアテステーションはオンチェーン検証（フェイルクローズ）を通った上で、payer の決済履歴と payee の受け取り履歴の**両方**に効きます。売り手が証跡を書き戻すほど、買い手を守るデータが貯まる構造です。

## インテグレータ向け API

```bash
# payer ウォレットでスコア（売り手側・x402 主経路）
curl -H "Authorization: Bearer $VOUCH_API_KEY" \
  https://agent-trust-tawny.vercel.app/api/v1/wallets/0xYOUR_PAYER/score

# payee ウォレットでスコア（買い手側・支払う前に）
curl -H "Authorization: Bearer $VOUCH_API_KEY" \
  https://agent-trust-tawny.vercel.app/api/v1/payees/0xTHEIR_WALLET

# 検証済み決済の証跡（txHash で冪等）
curl -X POST -H "Authorization: Bearer $VOUCH_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"wallet":"0xYOUR_PAYER","txHash":"0x...","resource":"/api/premium"}' \
  https://agent-trust-tawny.vercel.app/api/v1/payments/x402
```

agent ID 照会、バッチ、判定後の結果報告（`POST /v1/events/{id}/outcome`）、MCP（`check_wallet_trust` / `attest_x402_payment`）、TypeScript SDK（`packages/sdk`）もあります。SDK と MCP はまだ payee エンドポイント未対応で、エージェントランタイム向けの支出ポリシーヘルパーと合わせて次に載せる予定です。

## あえて選んだ設計

- ウォレット照合や致命的な RPC 失敗は **フェイルクローズ**（誤 ALLOW より拒否）
- **決済証跡はオンチェーン検証してから記録**（wallet と txHash の形式が正しいだけでは決済履歴を捏造できない）
- WL でも **シビル high は昇格させない**
- **匿名・無料 API の大解放は凍結**（クローズドβで価値検証）
- x402 加重はまず **10%**（データが溜まってから厚くする）

## クローズドβ

最初の対象は **x402 API 提供者**（payer ゲート＋決済証跡）と**エージェントランタイム実装者**（支払い前の payee スクリーニング）です。

- プロダクト: [agent-trust-tawny.vercel.app](https://agent-trust-tawny.vercel.app)
- コード / ドキュメント: [github.com/kzmttkc/agent-trust](https://github.com/kzmttkc/agent-trust)
- ガイド: `docs/x402-integration.md`、`docs/mcp-setup.md`、`docs/openapi.yaml`

参加希望は **この記事へのコメント or DM** で「何を作っているか」をください。合う方にキーを送ります（**招待コードは記事に書きません**）。

---

*Next.js / viem / Neon / Base 上の ERC-8004 レジストリ。タグライン: Trust layer for agent commerce.*
