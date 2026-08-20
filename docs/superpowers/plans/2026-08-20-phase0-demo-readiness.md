# vet402 Phase 0 — Demo & Submission Readiness 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 審査員・助成金審査員が5分以内に「実購入による検証」の差別化を理解できる状態（プレイグラウンド・OSS品質パッケージ・申請素材）を作る。

**Architecture:** 既存の観測所モジュール（probeEndpoint / runL1Batch / reserveSpend / reader）を一切複製せず再利用する。新規コードは「デモ用の薄い呼び口」（`src/lib/demo/` + `/api/v1/demo/verify` + `/playground`）に限定。資金が動く経路は既存のアトミック予約（reserveSpend・単一SQL）を通し、デモ専用フラグはデフォルトOFFで出荷する。

**Tech Stack:** Next.js 16 App Router / TypeScript / Drizzle / viem / tsx --test（既存テストランナー）

**正本:** `/Users/takeshi/Downloads/vet402_Technical_Implementation_Specification_v1.md` §4 Phase 0
**発注元の制約:** L0–L2は事実・L3は意見の分離を崩さない。fail-closed維持。破壊的変更禁止。日本語ドキュメントは第一級。

---

## 既存資産（再利用対象・再実装禁止）

| 資産 | 場所 | 用途 |
|---|---|---|
| L0プローブ | `src/lib/observatory/l0-probe.ts` `probeEndpoint(target, {fetchImpl, timeoutMs})` → `ProbeResult` | デモL0の実体。SSRFガード内蔵（`createSafeFetchImpl`） |
| L1実行＋予算 | `src/lib/observatory/l1-runner.ts` `runL1Batch` / 内部 `reserveSpend`（単一SQL・$25/日） | デモL1の実体。**予算判定を新設しない** |
| 集計リーダー | `src/lib/observatory/reader.ts` `getObservatoryOverview` / `getEndpointDetail` / `getEndpointPurchases` | プレイグラウンドの候補一覧と証拠表示 |
| IPレート制限 | `src/lib/api/ip-rate-limit.ts` `consumeIpRateLimit` / `src/lib/api/client-ip.ts` | デモAPIの防御 |
| SpendGuard判定 | `src/lib/scoring/verdict.ts` / `payee-engine.ts` | 「SpendGuardならALLOW/DENY」表示 |
| docker-compose | `docker-compose.yml`（Postgres単体・DB名`vouch`） | Task 7でapp serviceを追加 |
| CI | `.github/workflows/ci.yml`（typecheck/lint/test + Postgres service） | 変更不要。緑を維持する |

## タスク順序（仕様書の0.1→0.2→0.3順。Task 1のみ安全装置として先行）

---

### Task 1: DB誤適用の再発防止（.env修正＋db:pushプリフライト）

WO起票済み（2026-08-14に migration が `neondb` へ誤適用された事故の再発装置）。Phase 1でテーブル追加が控えるため最初に入れる。

**Files:**
- Modify: `~/vouch/.env.production.local`（git管理外・ローカルのみ）
- Create: `scripts/db-preflight.ts`
- Modify: `package.json`（`predb:push` / `predb:generate` フック）

- [ ] **Step 1: .env.production.local の DATABASE_URL 末尾を `/neondb` → `/vouch` に修正**（クエリ文字列 `?sslmode=…` は維持）
- [ ] **Step 2: プリフライトスクリプト作成**

```ts
// scripts/db-preflight.ts
// db:push / db:generate の前に必ず走る。接続先が本番DB「vouch」以外の
// Neonホストだった2026-08-14の誤適用（neondbへmigration適用）の再発装置。
// ローカル開発DB（docker-composeのvouch@localhost）は通す。
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("db-preflight: DATABASE_URL is not set");
  process.exit(1);
}
const dbName = new URL(url).pathname.replace(/^\//, "");
const isNeon = new URL(url).hostname.endsWith(".neon.tech");
if (isNeon && dbName !== "vouch") {
  console.error(
    `db-preflight: refusing to run against Neon database "${dbName}" — production database is "vouch" (see state/ALERTS.md 2026-08-14)`,
  );
  process.exit(1);
}
const sql = postgres(url, { max: 1 });
const [{ current_database }] = await sql`SELECT current_database()`;
await sql.end();
if (isNeon && current_database !== "vouch") {
  console.error(`db-preflight: connected database is "${current_database}", expected "vouch"`);
  process.exit(1);
}
console.log(`db-preflight: OK (${current_database})`);
```

- [ ] **Step 3: package.json にフック追加**（`"predb:push": "tsx scripts/db-preflight.ts"`・`"predb:generate": "tsx scripts/db-preflight.ts"`）
- [ ] **Step 4: 検証** — `DATABASE_URL=postgres://…neon.tech/neondb npm run db:push --dry-run` 相当でプリフライトが exit 1 すること・ローカルDBで OK が出ることを実走確認
- [ ] **Step 5: Commit** `feat(db): db:push前にNeon接続先DB名をassertするプリフライト——8/14のneondb誤適用の再発装置`

---

### Task 2: デモ検証コア `src/lib/demo/verify.ts`（L0・TDD）

**Files:**
- Create: `src/lib/demo/verify.ts`
- Test: `tests/demo-verify.test.ts`

- [ ] **Step 1: 失敗するテストを書く** — カタログ実在endpointのL0デモ（fetchImpl注入で402チャレンジを返すモック）で `ProbeResult` が返ること・存在しないIDで `{ok:false, reason:"endpoint_not_found"}`・SpendGuard verdictが同梱されること
- [ ] **Step 2: テスト失敗を確認** `npx tsx --test tests/demo-verify.test.ts` → FAIL
- [ ] **Step 3: 最小実装**

```ts
// src/lib/demo/verify.ts
// /playground の背後。観測所のL0プローブをそのまま1エンドポイントに対して
// ライブ実行して返す。ここは「見せるための呼び口」であって測定系ではない:
// 結果は x402_l0_probes へ書かない（デモ起因の測定が公開台帳の
// ケイデンスを汚さないため）。資金は動かない（L0は無料プローブ）。
import { db } from "@/lib/db";
import { x402Endpoints } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { probeEndpoint, type ProbeResult, type ProbeOptions } from "@/lib/observatory/l0-probe";

export type DemoVerifyResult =
  | { ok: true; endpoint: { id: string; resourceKey: string; payTo: string | null }; probe: ProbeResult }
  | { ok: false; reason: "endpoint_not_found" | "endpoint_inactive" };

export async function runDemoL0(endpointId: string, options: ProbeOptions = {}): Promise<DemoVerifyResult> {
  const row = await db.query.x402Endpoints.findFirst({ where: eq(x402Endpoints.id, endpointId) });
  if (!row) return { ok: false, reason: "endpoint_not_found" };
  if (row.status !== "active") return { ok: false, reason: "endpoint_inactive" };
  const probe = await probeEndpoint(
    { resourceUrl: row.resourceUrl, method: row.method, payTo: row.payTo, network: row.network, priceAmount: row.priceAmount, priceAsset: row.priceAsset },
    options,
  );
  return { ok: true, endpoint: { id: row.id, resourceKey: row.resourceKey, payTo: row.payTo }, probe };
}
```

（スキーマの実カラム名は `src/lib/db/schema.ts:542-580` を実装時に照合。`status`/`resourceUrl` 等の名称が異なる場合はスキーマ側に合わせる）

- [ ] **Step 4: テスト緑を確認**
- [ ] **Step 5: Commit** `feat(demo): プレイグラウンド用L0ライブ検証コア——観測所プローブ再利用・台帳へ書かない`

---

### Task 3: `POST /api/v1/demo/verify` ルート

**Files:**
- Create: `src/app/api/v1/demo/verify/route.ts`

- [ ] **Step 1: ルート実装**（thin wrapper: `getClientIp` → `consumeIpRateLimit("demo-verify:"+ip, 5, 60_000)` → body `{endpointId}` zod検証 → `runDemoL0` → 200/404/429。既存の `observatory/state/route.ts` のレート制限とヘッダの作法をそのまま踏襲）
- [ ] **Step 2: typecheck + 手動実測** — ローカル `npm run dev` で実カタログIDに対して curl し、`ProbeResult` JSONが返ること・6連打で429が返ることを確認
- [ ] **Step 3: Commit** `feat(api): POST /api/v1/demo/verify——playground用・IPレート制限付きL0ライブ検証`

---

### Task 4: `/playground` ページ

**Files:**
- Create: `src/app/playground/page.tsx`（server: `getObservatoryOverview` で候補を取得しclientへ）
- Create: `src/app/playground/playground-client.tsx`（client: 選択→検証→証拠表示）

**表示要素（仕様0.1）**: エンドポイント選択・L0発火ボタン・ライブ結果（verdict/latency/402チャレンジ有無/価格整合）・SpendGuard判定表示・そのエンドポイントの実購入履歴（`getEndpointPurchases` → txHashリンク）・観測所詳細 `/observatory/e/[id]` への導線。

**体裁**: 既存の観測所ページ（RFC紙面様式・承認済みブランド）のコンポーネント/クラスを踏襲。新デザインを発明しない。デスクトップ・モバイル両方でスクショ確認。

- [ ] **Step 1: server page + client component 実装**（候補は直近L0 passの上位20件に限定し、初見でも「動くもの」を踏ませる）
- [ ] **Step 2: ローカル実測**（L0発火→結果表示→purchases表示）・375×812でfold内に主要導線が入ることを確認
- [ ] **Step 3: Commit** `feat(playground): 実購入検証のライブデモページ——L0発火・証拠表示・実購入履歴`

---

### Task 5: デモL1発火（フラグOFFで出荷・資金経路は既存予約を通す）

**Files:**
- Modify: `src/lib/observatory/l1-runner.ts`（`runL1Batch` に `onlyEndpointId?: string` オプション追加——候補選定を1件に絞るだけ。reserveSpend・$25/日キャップ・台帳記帳はそのまま通る）
- Modify: `src/app/api/v1/demo/verify/route.ts`（`level:"l1"` 受理。`DEMO_L1_ENABLED==="true"` かつ既存 `isL1Enabled()` の二重ゲート・IPあたり1回/日）
- Test: `tests/demo-verify.test.ts` に追記（フラグOFF時に `demo_l1_disabled` で拒否されること・onlyEndpointId で候補が1件に絞られること）

**設計判断**: デモ専用の別予算・別ウォレットは作らない（[[no-unjustified-funds-at-risk]]——使う仕組みが動くまで資金を増やさない）。既存の $25/日 の中で、既存のアトミック予約（単一SQL・TOCTOU耐性）を通す。**デフォルトOFFで出荷し、ONにするのはハッカソン審査の時だけ**。

- [ ] **Step 1: テスト追記→失敗確認**
- [ ] **Step 2: 実装→緑確認**（`npm test` 全体も緑）
- [ ] **Step 3: Commit** `feat(demo): L1デモ発火——既存予約経路・二重フラグ・デフォルトOFF`

---

### Task 6: ハッカソン・スターターキット `examples/hackathon-starter/`

**Files:**
- Create: `examples/hackathon-starter/README.md`（EN・ETHGlobal continuity/agent track向け・clone→run 3手順）
- Create: `examples/hackathon-starter/package.json`・`index.ts`

**内容**: 最小エージェント——①`@vouchscore/sdk` でpayeeスコア取得 → ②SpendGuard判定（fail-closed例示）→ ③ALLOWなら x402 支払い（実送金はコメントアウトしたテンプレ＋testnet手順）→ ④検証結果のattest例。既存 `examples/agentkit-spend-guard`・`x402-trust-gate` と重複する部分はREADMEから参照し、コードを複製しない。

- [ ] **Step 1: 実装**（既存2 examplesの作法・依存の張り方を踏襲）
- [ ] **Step 2: `npm install && npx tsx index.ts` が設定なしでdry-run完走することを確認**
- [ ] **Step 3: Commit** `docs(examples): hackathon-starter——SDK+SpendGuard+attestの最小エージェント`

---

### Task 7: OSS品質パッケージ（ARCHITECTURE・CONTRIBUTING・日本語docs・README刷新）

**Files:**
- Create: `docs/ARCHITECTURE.md`（EN・Mermaid図2枚: ①検証フロー L0→L1→L2→（分離された）L3・②データフロー catalog-sync→probe→ledger→API/badge。モジュール地図は本計画冒頭の表を出発点に）
- Create: `CONTRIBUTING.md`（docker compose up → npm install → npm test の実手順・first issues 3件・PR作法）
- Create: `docs/ja/README.md`・`docs/ja/ARCHITECTURE.md`（翻訳でなく同格の正本として書く——発注元指示「日本語は第一級」）
- Modify: `README.md`（playground・ARCHITECTURE・ja/ への導線追加。既存の主張は実測数字と食い違わないよう `/api/v1/observatory/state` の現在値で検算してから書く）

- [ ] **Step 1: ARCHITECTURE.md + 図**（図はコードから起こす。想像で書かない）
- [ ] **Step 2: CONTRIBUTING.md**（記載コマンドは全部実走して通ることを確認してから書く）
- [ ] **Step 3: docs/ja/ 2本**
- [ ] **Step 4: README刷新 + Commit** `docs: ARCHITECTURE/CONTRIBUTING/ja——OSS品質パッケージ(Phase0.2)`

---

### Task 8: docker-compose フルスタック化

**Files:**
- Create: `Dockerfile`（node:22-alpine・`next build` standalone）
- Modify: `docker-compose.yml`（`app` service追加: build .・`DATABASE_URL=postgres://vouch:vouch_dev@postgres:5432/vouch`・depends_on healthcheck・3000公開。既存のpostgres定義は変えない）
- Modify: `.env.example`（新フラグ `DEMO_L1_ENABLED` 追記）

- [ ] **Step 1: Dockerfile + compose 実装**
- [ ] **Step 2: `docker compose up` → `curl localhost:3000` がトップを返すことを実測**（15分以内に新規コントリビュータが到達できるか、手順をCONTRIBUTING.mdに反映）
- [ ] **Step 3: Commit** `feat(dev): docker composeでフルスタック起動——新規コントリビュータの15分オンボード(Phase0.2)`

---

### Task 9: 申請素材パッケージ `docs/applications/`

**Files:**
- Create: `docs/applications/why-base.md`・`why-solana.md`・`why-ethereum-agent-economy.md`・`impact-one-pager.md`・`milestones-budget-template.md`・`video-script.md`（2–3分・実フロー: catalog→L0→L1実購入→証拠公開→バッジ）・`ai-usage-disclosure.md`

**規律**: 数字は書く時点で `/api/v1/observatory/state` から取り直す（一次データ）。将来の約束はmilestone欄のみに書き、実績欄に混ぜない。既存 `docs/ecosystem-x402-foundation.md`・`output/0819/vet402_ethglobal_ビルド&ピッチ_playbook_2026-08-19.md` の既書き分を再利用し二重執筆しない。

- [ ] **Step 1: 7ファイル執筆**
- [ ] **Step 2: Commit** `docs(applications): 助成金・ハッカソン申請素材一式(Phase0.3)`

---

## Phase 0 でやらないこと（明示的スコープ外）

- **動画の収録・公開**: script（Task 9）まで。収録・公開はブランド公開物なのでTakeshi承認フロー（approval-queue）へ
- **助成金の実提出**: AQ-030系の承認済みフローで別途（外部送信）
- **Solana対応・ChainAdapter**: Phase 1（仕様書の順序厳守）
- **旧$49/$199 JSON-LD offers是正・モバイルfold・ブランチ棚卸し**: 既存WORK_ORDERSの別件。ただしTask 4で `page.tsx` に触れる場合はfold所見を悪化させない

## 完了の定義（仕様書 Acceptance Criteria の実測版）

1. 初見の人が `/playground` で5分以内にL0検証デモを完走できる（本番URLで実測・スクショ）
2. `docker compose up` だけでフルスタックが立つ（クリーン環境で実測）
3. `npm test`・CI緑・`npm run build` 実走成功（[[nextjs-build-verify-before-push]]）
4. docs/applications/ が「コードを読まずに理解できる」状態（数字は state API の実測値）
