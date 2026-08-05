# 保証引受（guarantee underwriting）設計 — N-20（2026-08-05）

## 一言で
「Vouch の ALLOW に金を賭ける」商品の引受判定を、公開中の /accuracy と
**同一の実測レポート**から決定論的に導く。実装は純関数
`src/lib/guarantee/underwriting.ts`（テスト: `tests/guarantee-underwriting.test.ts` 7件）。

## なぜ堀か
スコアAPIは模倣可能。しかし保証は「精度の実績」を担保にしないと成立せず、
実績は /accuracy の蓄積（=時間と顧客）でしか作れない。後発はこの順序を飛ばせない。

## 引受ルール（fail closed）
| 条件 | 閾値 | 落ちた場合 |
|---|---|---|
| 解決済み判定数 | ≥ 200（`UNDERWRITE_MIN_RESOLVED`） | 提供不可 |
| ALLOW損失率 | 計測済み かつ ≤ 2% | null/超過とも提供不可 |
| 補償上限 | min($5,000, 解決済み件数×$1) | — |
| 保険料率 | max(0.5%, 損失率×5) | — |

- 値付けの入力は `AccuracyReport` のみ。**公開数字より甘い内部数字で引き受けない**
- 欠格事由は全件列挙（blockers[]）。理由コードは機械可読

## 現状と発動条件
- **休眠**。事業判断は approval-queue **AQ-016**
- 発動 = 解決済み200件到達 → Legal審査（保証業該当性）→ 商品化
- それまで対外的に言及しない（実測なしの匂わせは brand 原則違反）
