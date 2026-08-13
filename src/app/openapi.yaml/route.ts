import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Serve the machine-readable API contract at https://vet402.com/openapi.yaml.
 *
 * 2026-08-13 UX監査L3 [P1/P5・実装者]。404 で失われていた: docs も 404 JSON も
 * 「schema at docs/openapi.yaml」と案内するのに、実装者がまず叩く
 * `https://vet402.com/openapi.yaml` は 404 で、実在は GitHub の生ファイルだけ
 * だった。コード生成のために spec を取りに来た実装者がそこで手を止める。
 *
 * 正典は docs/openapi.yaml のまま（tests/machine-readable-honesty.test.ts と
 * 各 README がそこを参照する）。ここはそれを force-static でビルド時に一度
 * 読み、配信するだけ——二重管理・ドリフトを作らない（実体は常に正典の写し）。
 */
export const dynamic = "force-static";

export function GET() {
  const spec = readFileSync(join(process.cwd(), "docs", "openapi.yaml"), "utf8");
  return new Response(spec, {
    headers: {
      "content-type": "application/yaml; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
