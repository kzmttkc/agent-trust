// ============================================================
// Vouch — safeJsonLd（JSON-LD ブレイクアウト予防関門）のテスト。
//
// WHY (2026-08-13 監査 L-2): JSON-LD は dangerouslySetInnerHTML で
// <script type="application/ld+json"> に流れる。script 要素の中身は生テキスト
// なので、データに "</script>" を含む文字列が混ざるとブラウザはそこで要素を
// 閉じ、残りをマークアップとして解釈する（= XSS 経路）。現状のデータは静的
// リテラル由来で悪用不可だが、この関門が経路に立ち続けることを保証する。
// ============================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import { safeJsonLd } from "@/lib/util/json-ld";

test("safeJsonLd: </script> を含む入力から '<' が消えエスケープされる", () => {
  const payload = {
    "@type": "BlogPosting",
    headline: `</script><script>alert(1)</script>`,
  };
  const out = safeJsonLd(payload);
  // 出力のどこにも生の "<" が残らない（script 要素を閉じられない）
  assert.ok(!out.includes("<"), `raw "<" leaked: ${out}`);
  assert.ok(out.includes("\\u003c/script>"), "expected \\u003c escape");
});

test("safeJsonLd: エスケープしても JSON として同値（往復で完全復元）", () => {
  const payload = { name: "a<b & </script>", nested: { arr: ["<", "<<"] } };
  assert.deepEqual(JSON.parse(safeJsonLd(payload)), payload);
});

test("safeJsonLd: '<' を含まない通常データは JSON.stringify と一致", () => {
  const payload = { "@context": "https://schema.org", "@type": "Organization", name: "vet402" };
  assert.equal(safeJsonLd(payload), JSON.stringify(payload));
});
