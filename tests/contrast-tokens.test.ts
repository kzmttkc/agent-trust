// ============================================================
// Vouch — 文字色トークンの静的コントラスト関門。
//
// 2026-08-12: 本番の「実描画ピクセル」計測で AA 不合格が 15件出た。前日に
// 「達成」と報告した直後で、トークン表を目視で追う運用では同じ穴が二度開く
// ことが実証された。成果物（その15件）を直すだけでは同型が必ず戻ってくるので、
// 出した経路そのものに関門を置く。
//
// このテストは実行時のレンダリングを見ない。見るのは「どの Tailwind 文字色
// トークンを、どの地色クラスの上で使ってよいか」という一点だけ。実描画計測
// （Playwright）は重くて CI に載らないが、実際に起きた不合格はすべて
// 「トークンの組み合わせ」の段階で判定できる形をしていた。
//
// 契約:
//   1. src/ に text-zinc-400 は存在しない（白地 2.62:1・zinc-50 上 2.51:1）。
//      文字にも、意味を担うアイコンにも使えない階調。
//   2. bg-zinc-100 のチップ（code / badge）は文字色を明示する。継承すると
//      親の text-zinc-500 が乗って 4.39:1 になり AA を割る。
// ============================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(process.cwd(), "src");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(tsx|ts|css)$/.test(name)) out.push(p);
  }
  return out;
}

const FILES = walk(SRC).map((path) => ({ path, text: readFileSync(path, "utf8") }));

// className 文字列の中身だけを見る。日本語の由来コメントに書かれたトークン名を
// 違反として拾ってしまうと、なぜ直したのかを書けなくなる。
function classAttrs(source: string): { line: number; value: string }[] {
  const out: { line: number; value: string }[] = [];
  const re = /className\s*[:=]\s*(?:\{?\s*)?(["'`])([\s\S]*?)\1/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    out.push({ line: source.slice(0, m.index).split("\n").length, value: m[2] });
  }
  return out;
}

test("text-zinc-400 は src/ のどの className にも存在しない（白地 2.62:1）", () => {
  const hits: string[] = [];
  for (const f of FILES) {
    for (const a of classAttrs(f.text)) {
      if (/\btext-zinc-400\b/.test(a.value)) hits.push(`${f.path}:${a.line}`);
    }
  }
  assert.deepEqual(hits, [], `text-zinc-400 (#A1A1AA) は白地 2.62:1 で AA 不合格。text-zinc-500 (4.83:1) を使う: ${hits.join(", ")}`);
});

test("bg-zinc-100 のチップは文字色を明示する（継承した zinc-500 は 4.39:1）", () => {
  const hits: string[] = [];
  for (const f of FILES) {
    for (const a of classAttrs(f.text)) {
      if (!/\bbg-zinc-100\b/.test(a.value)) continue;
      // 文字を持たない帯（プログレスバー等）は対象外。px/py の内側寸法を持つ
      // ものだけがテキストチップ。
      if (!/\bp[xy]?-/.test(a.value)) continue;
      if (!/\btext-zinc-(600|700|800|900)\b/.test(a.value)) hits.push(`${f.path}:${a.line}`);
    }
  }
  assert.deepEqual(
    hits,
    [],
    `bg-zinc-100 (#F4F4F5) の上では text-zinc-500 が 4.39:1 で AA を割る。チップ側に text-zinc-700 (9.50:1) を明示する: ${hits.join(", ")}`,
  );
});
