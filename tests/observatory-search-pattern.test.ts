// ============================================================
// /observatory の検索語は、ILIKE のワイルドカードとして解釈されない。
//
// WHY (2026-08-22 監査). `%${q}%` をそのまま `ILIKE ${like}` へ渡していた。
// バインド済みなのでインジェクションではない——が、`%` と `_` は
// **バインドされた値の内側で**ワイルドカードとして効く。長さ上限も
// この経路には無く、キー不要の面から `%_%_%_%_%…` を投げるだけで
// DB に他人の勘定で重い仕事をさせられた。
// ============================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import { searchLikePattern } from "@/lib/observatory/reader";

test("空の検索語はパターンを作らない（フィルタ自体が付かない）", () => {
  assert.equal(searchLikePattern(null), null);
  assert.equal(searchLikePattern(""), null);
  assert.equal(searchLikePattern("   "), null);
});

test("ふつうの語は前後だけがワイルドカード", () => {
  assert.equal(searchLikePattern("svc.example"), "%svc.example%");
  assert.equal(searchLikePattern("  svc.example  "), "%svc.example%");
});

test("% と _ とバックスラッシュはエスケープされ、リテラルとして照合される", () => {
  assert.equal(searchLikePattern("100%"), "%100\\%%");
  assert.equal(searchLikePattern("a_b"), "%a\\_b%");
  assert.equal(searchLikePattern("a\\b"), "%a\\\\b%");
  // 監査が挙げた増幅パターン: ワイルドカードが1つも残らないこと。
  const amplifier = "%_".repeat(20);
  const pattern = searchLikePattern(amplifier)!;
  const inner = pattern.slice(1, -1);
  assert.equal(/(^|[^\\])[%_]/.test(inner), false, `wildcard survived: ${pattern}`);
});

test("長さ上限がある（無制限の語をDBへ渡さない）", () => {
  const pattern = searchLikePattern("a".repeat(500))!;
  assert.equal(pattern, `%${"a".repeat(80)}%`);
});
