// ============================================================
// vet402 — ダッシュボードログインに渡された「HTTPヘッダに載らないAPIキー」。
//
// 2026-08-15 認証監査で発見。authenticateDashboardLogin() は受け取った文字列を
// そのまま `new Request(..., { headers: { Authorization: "Bearer " + apiKey } })`
// に載せる。undici の Headers は制御文字(CR/LF/NUL 等)を含む値を TypeError で
// 拒否するため、apiKey に改行を1つ入れて POST /api/dashboard/session を叩くと
// 401 ではなく **未捕捉例外 → 500** が返っていた（no-JS の Server Action 側の
// ログインも同じ経路）。認証の突破にはならないが、未認証の第三者が任意に本番の
// サーバ例外を起こせる状態で、ログイン失敗は 401 に閉じるべき。
//
// 期待する挙動: ヘッダ値として表現できない入力は「そんな鍵は存在しない」= null。
// 実在する鍵の判定経路（verifyApiKey）は一切変えない。
// ============================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import { authenticateDashboardLogin } from "@/lib/dashboard/auth";

const LF = String.fromCharCode(0x0a);
const CR = String.fromCharCode(0x0d);
const NUL = String.fromCharCode(0x00);
const DEL = String.fromCharCode(0x7f);

test("改行を含むAPIキーは例外ではなく null を返す（ログインは401に閉じる）", async () => {
  const result = await authenticateDashboardLogin(`vouch_live_deadbeef${LF}X-Injected: 1`);
  assert.equal(result, null);
});

test("CR / NUL / DEL を含むAPIキーも同様に null", async () => {
  for (const bad of [
    `vouch_live_deadbeef${CR}${LF}X-Injected: 1`,
    `vouch_live_dead${NUL}beef`,
    `vouch_live_dead${DEL}beef`,
  ]) {
    assert.equal(await authenticateDashboardLogin(bad), null, `rejected: ${escape(bad)}`);
  }
});

test("通常の形をしたキーは（DB無しでも）例外なく null を返す — 回帰の土台", async () => {
  const result = await authenticateDashboardLogin("vouch_live_0123456789abcdef");
  assert.equal(result, null);
});
