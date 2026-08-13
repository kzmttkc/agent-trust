// SITE_URL の正典（2026-08-13 監査是正）。
// 以前は https://agent-trust-tawny.vercel.app が6ファイルにハードコードされており、
// vet402.com への移行時に sitemap/robots/canonical/OG が旧ドメインを指し続けた。
// 対外出力に効く URL はすべてここから import する。同じ値を2箇所に書かない。
// NEXT_PUBLIC_ プレフィックスなのでクライアントコンポーネントからも参照できる
// （ビルド時にインライン化される）。Vercel 側の env 設定は不要 — フォールバックが本番値。
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://vet402.com";
