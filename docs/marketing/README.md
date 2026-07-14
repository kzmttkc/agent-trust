# Vouch — Dev.to / Zenn / X アカウント一式

クローズドβ向けのプロフィール素材と初稿記事です。

## 画像（このリポジトリ内）

| ファイル | 用途 | 推奨サイズ |
|----------|------|------------|
| [`assets/vouch-icon.png`](./assets/vouch-icon.png) | アイコン / アバター | 正方形（そのままアップロード可） |
| [`assets/vouch-banner.png`](./assets/vouch-banner.png) | バナー / カバー | 16:9（Dev.to Cover・X Header に可） |

色: インク系ネイビー／チャコール + ティールアクセント `#0D9488`。紫・ネオングロー禁止方針に合わせています。

## 共通ブランド

| 項目 | 値 |
|------|-----|
| 製品名 | **Vouch** |
| 表示名（EN） | Vouch |
| 表示名（JP） | Vouch（バウチ） |
| タグライン | Trust layer for agent commerce |
| 一言説明 | ERC-8004 trust scores on Base for x402 API providers |
| 本番 | https://agent-trust-tawny.vercel.app |
| GitHub | https://github.com/kzmttkc/agent-trust |
| 招待 | **記事・Bio に招待コードを書かない**（DM / 個別配布） |

---

## Dev.to

### アカウント作成時の入力

| フィールド | 推奨値 |
|------------|--------|
| **Name** | `Vouch` |
| **Username** | `vouch`（取れなければ `vouchdev` / `getvouch`） |
| **Profile image** | `vouch-icon.png` |
| **Website URL** | `https://agent-trust-tawny.vercel.app` |
| **Twitter/X** | （開設したら `@…` を後で追記） |
| **GitHub** | `https://github.com/kzmttkc/agent-trust` |
| **Location** | `Global` |
| **Bio** | 下記 |

**Bio（約160字以内想定）:**

```
Trust layer for agent commerce. ERC-8004 scores on Base → ALLOW / WARN / BLOCK for x402 gateways. Closed beta.
```

**About（長い場合）:**

```
Vouch scores AI agents 0–100 using ERC-8004 identity & reputation, wallet heuristics, and x402 settlement attestations — so API providers can decide before they serve paid routes.

Built for x402 integrators. Stack: Base, Next.js, TypeScript. Closed beta (invite only).
```

### 最初の記事

原稿: [`articles/devto-x402-trust-before-payment.md`](./articles/devto-x402-trust-before-payment.md)

- Title / tags はファイル先頭の front matter をコピー
- Cover image: `vouch-banner.png`
- 公開後、記事末の CTA は GitHub + サイトのみ（コードは載せない）

---

## Zenn

### アカウント作成時の入力

| フィールド | 推奨値 |
|------------|--------|
| **表示名** | `Vouch` |
| **ユーザー名** | `vouch`（取れなければ `vouch-dev`） |
| **アイコン** | `vouch-icon.png` |
| **自己紹介** | 下記 |
| **Web** | `https://agent-trust-tawny.vercel.app` |

**自己紹介:**

```
エージェントコマースの信頼レイヤー。Base上のERC-8004信頼スコアをAPIで提供。x402 API提供者が支払い前にALLOW/WARN/BLOCK判定できる。クローズドβ募集中（招待制）。
```

Zennにバナー欄がない場合はアイコンのみ。記事カバーに `vouch-banner.png` を使う。

### 最初の記事

原稿: [`articles/zenn-x402-trust-score.md`](./articles/zenn-x402-trust-score.md)

- 記事タイプ: **tech**
- Topics 例: `AI`, `Web3`, `TypeScript`, `API`

---

## X（任意・同時開設するなら）

| フィールド | 推奨値 |
|------------|--------|
| **Name** | `Vouch` |
| **Handle** | `@vouchdev` または `@getvouch`（空き確認） |
| **Icon** | `vouch-icon.png` |
| **Banner** | `vouch-banner.png` |
| **Bio** | `Trust layer for agent commerce. ERC-8004 scores on Base for x402. Closed beta.` |
| **Website** | `https://agent-trust-tawny.vercel.app` |
| **Location** | `Base / Global` |

最初の固定ポスト案:

```
Payment proves who paid.
It doesn’t prove who you can trust.

Vouch → ERC-8004 trust scores on Base (ALLOW / WARN / BLOCK) for x402 gateways.

Closed beta. DM for invite.
→ https://agent-trust-tawny.vercel.app
→ github.com/kzmttkc/agent-trust
```

---

## チェックリスト

- [ ] Dev.to アカウント + Bio + アイコン
- [ ] Dev.to に英語記事を下書き→公開
- [ ] Zenn アカウント + 自己紹介 + アイコン
- [ ] Zenn に日本語記事を下書き→公開
- [ ] （任意）X 開設・固定ポスト
- [ ] 記事コメント／DMで招待を個別配布（コードを公開発言しない）
