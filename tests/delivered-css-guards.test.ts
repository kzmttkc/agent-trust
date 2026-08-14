// ============================================================
// Vouch — 配信CSSに死んだ規則が焼き込まれない状態を保つ関門。
//
// 2026-08-12 に同じ事故を3回繰り返した。src/ から禁止トークンを消しても、
// 配信CSSには規則が残り続けた。Tailwind v4 の自動検出は .gitignore 済み以外の
// リポジトリ全体を走査し、コメントや正規表現の中の文字列も候補として拾うため、
// 「使うな」と書いた場所そのものが出力源になる。
//
//   1回目 abc36df: tests/ の禁止リストが border 系5本を焼き込んでいた
//   2回目 3acc972: 同じ関門の text-zinc-400 が残っていた → tests/ を走査から外した
//   3回目 805fda0: vercel CLI が .claude/worktrees/ の複製を丸ごとアップロードし、
//                  複製側の tests/ から復活していた → .claude/ も走査から外した
//
// 壊れるのは描画ではなく検証手段のほうで、そこが厄介だった。「配信CSSに残って
// いるか」でデプロイの反映を確かめる手（過去に「HTMLは新しいのにCSSが古い」事故で
// 使った手）が、嘘をつくようになる。
//
// 成果物を直すだけでは同型が戻るので、経路に関門を置く。ここで見るのは3点:
//   1. Tailwind の走査除外が消えていないこと
//   2. .vercelignore が既定の無視規則を取りこぼしていないこと
//   3. 走査対象に残っているファイルに完全形の禁止トークンが無いこと
//
// このファイル自身も禁止トークンを完全形では書かない。tests/ は走査から外して
// あるので実害は無いが、除外が外れた時に真っ先に自分が汚染源になるのは間抜けなので。
// ============================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

// 全面禁止のトークンだけを見る。border 系の弱い階調（zinc-200 等）は入力欄の枠線
// としてだけ禁止で、カードや表の装飾罫線としては正当に使っている（border-zinc-200 は
// 55箇所）。文脈依存の禁止は contrast-tokens.test.ts が要素を見て判定しており、
// ここで文字列だけを見て全面禁止にすると実使用を巻き込む。
// 接頭辞と値は実行時に連結する（理由は上のコメントの最後の段落）。
const FORBIDDEN = ["zinc-400"].map((c) => `text-${c}`);

test("Tailwind の走査除外（tests/ と .claude/）が globals.css に残っている", () => {
  const css = readFileSync(join(ROOT, "src/app/globals.css"), "utf8");
  for (const dir of ["../../tests", "../../.claude"]) {
    assert.ok(
      new RegExp(`@source\\s+not\\s+["']${dir.replace(/\./g, "\\.")}["']`).test(css),
      `globals.css の @source not "${dir}" が消えている。これが無いと、そのディレクトリに` +
        `書かれた禁止トークンが配信CSSへ焼き込まれる（3acc972 / 805fda0）。`,
    );
  }
});

test(".vercelignore が既定の無視規則を取りこぼしていない", () => {
  // .vercelignore がある場合 .gitignore は参照されない。つまりここに書き忘れた
  // ものはビルド機へ上がる。node_modules を上げると転送量が跳ね、state/ は
  // 外部の申込メール（PII）を含む。
  const lines = readFileSync(join(ROOT, ".vercelignore"), "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  // state/logs は 2026-08-14 に先頭スラッシュ付きへ修正済み（無アンカー行が
  // /observatory/state を誤って本番から消していたため）。ここもそれに追随する。
  for (const must of [".git", "node_modules", ".next", ".vercel", ".claude", "/state", "/logs"]) {
    assert.ok(
      lines.includes(must),
      `.vercelignore に ${must} が無い。.gitignore は参照されないので、` +
        `書かれていないものはそのまま本番のビルド機へ上がる。`,
    );
  }
});

test("走査対象に残っているファイルに完全形の禁止トークンが無い", () => {
  // --others を付けて未追跡ファイルまで見る。追跡済みだけを見ると意味がない:
  // 2026-08-12 の事故は .claude/worktrees/ の複製という未追跡ファイルが原因で、
  // Tailwind は .gitignore 済み以外なら追跡状態に関係なく走査する。--exclude-standard
  // で .gitignore 済みを落とすと、残るのがちょうど走査対象になる。
  // tests/ と .claude/ は @source not で外してあるので対象外。
  const scanned = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .filter((p) => p && !p.startsWith("tests/") && !p.startsWith(".claude/"));

  const hits: string[] = [];
  for (const rel of scanned) {
    let text: string;
    try {
      text = readFileSync(join(ROOT, rel), "utf8");
    } catch {
      continue; // バイナリや削除済みは飛ばす
    }
    for (const token of FORBIDDEN) {
      const re = new RegExp(`\\b${token.replace(/-/g, "\\-")}\\b`);
      if (re.test(text)) hits.push(`${rel}: ${token}`);
    }
  }

  assert.deepEqual(
    hits,
    [],
    "完全形の禁止トークンが走査対象のファイルに書かれている。使っていなくても配信CSSに " +
      "規則が出力され、配信CSSを読んで使用実態を調べる手が使えなくなる。説明したい時は " +
      "接頭辞を離して書く（例: zinc-400 と色名だけにする）:\n  " +
      hits.join("\n  "),
  );
});
