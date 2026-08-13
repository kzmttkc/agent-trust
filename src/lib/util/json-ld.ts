// JSON-LD を dangerouslySetInnerHTML で <script type="application/ld+json"> に
// 流し込むときの共通関門（2026-08-13 監査 L-2）。
//
// JSON.stringify はスクリプトコンテキストを知らない: データに "</script>" を含む
// 文字列があると、ブラウザの HTML パーサはそこでスクリプト要素を閉じ、残りを
// マークアップとして解釈する（script 要素内はエスケープが効かない生テキスト）。
// 現状の JSON-LD データはすべて静的リテラル由来で悪用不可だが、将来 DB や
// ユーザー入力由来の文字列（例: ブログ本文・エージェント名）が混ざった瞬間に
// XSS になる。個々の呼び出し側の注意ではなく、経路に関門を置く。
//
// "<" を < にエスケープする。JSON として意味は同一（JSON.parse で完全に
// 復元される）ため、構造化データの解釈には影響しない。
export function safeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
