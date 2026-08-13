/**
 * VerdictBadge — ALLOW / WARN / BLOCK の唯一の表示体。
 *
 * 2026-08-11 UI監査: 判定語はこの製品で最も重要な1語なのに、扱いが4通りに
 * 割れていた。ホームだけが色付きピルで、/agent/[agentId]・/payee/[address]・
 * /leaderboard・/accuracy は素の等幅文字。同じ BLOCK が画面によって
 * 「赤いバッジ」だったり「ただの黒い文字」だったりする状態だった。ここへ集約する。
 *
 * 2026-08-13 UI監査是正 #2 — RFC 文法へ再造形。
 * それまでは Tailwind の 100/800（emerald / amber / red）のベタ塗りチップだった。
 * /leaderboard では25行中18行が黄・7行が赤のベタ面になり、塗り面積が「判定の重さ」
 * ではなく「行数」に比例して増えて、順位表そのものより先に目に入っていた。
 *
 * いま出しているのは、同じ頁の benchmark チップ（.marker-plan）と同じ文法:
 * 1px の罫・紙地のまま・**文字色だけが機能色**。塗り面はゼロで、色は文字と細い罫に
 * しか乗らない。色相は CEO 裁定（2026-08-13）の warn #973c00 / block #9f0712 を
 * そのまま使っている（白地 7.09:1 / 8.36:1）。造形と色の所在は globals.css の
 * .marker-verdict-* に置いてある。
 *
 * ALLOW が紺なのは、承認された機能色が WARN と BLOCK の2つだけで緑がこの
 * パレットに無いことと、ALLOW が「旗が上がっていない」状態＝信号ではないため。
 *
 * 読み上げは変えていない。中身は判定語そのもののテキストノード1つのままなので、
 * /payee/[address] が外側に置いている role="img" + aria-label
 * （"Trust score 37 out of 100, recommendation BLOCK"）はそのまま効く。
 */

const VERDICT_STYLE: Record<string, string> = {
  ALLOW: "marker-verdict-allow",
  WARN: "marker-verdict-warn",
  BLOCK: "marker-verdict-block",
};

export function VerdictBadge({
  verdict,
  className = "",
}: {
  verdict: string;
  className?: string;
}) {
  // 未知の判定語（将来スコアリング側が band を増やした場合）は破線の中立で出す。
  // 「知らない値だから ALLOW にしておく」は絶対にやらない — 判定表示で
  // fail-open するとユーザーに嘘の安全を見せることになる。破線はこの世界で
  // 「まだ引かれていない」を意味していて、未知の band の扱いとして正しい。
  const style = VERDICT_STYLE[verdict] ?? "marker-plan";
  return <span className={`marker ${style} ${className}`.trim()}>{verdict}</span>;
}
