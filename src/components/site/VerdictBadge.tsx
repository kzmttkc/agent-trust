/**
 * VerdictBadge — ALLOW / WARN / BLOCK の唯一の表示体。
 *
 * 2026-08-11 UI監査: 判定語はこの製品で最も重要な1語なのに、扱いが4通りに
 * 割れていた。ホームの ScorePreviewCard だけが色付きピル
 * (RECOMMENDATION_STYLE) で、/agent/[agentId]・/payee/[address]・/leaderboard・
 * /accuracy は素の等幅文字。同じ BLOCK が画面によって「赤いバッジ」だったり
 * 「ただの黒い文字」だったりする状態だった。ここへ集約する。
 *
 * 色はブランドの紺ではなく **意味色**（emerald/amber/red）を使う。判定は
 * ブランド表現ではなく信号であり、ブランド変更に追随させてはいけないため。
 * いずれも Tailwind の 100/800 の組みで白地・地色ともに AA を満たす。
 */

const VERDICT_STYLE: Record<string, string> = {
  ALLOW: "bg-emerald-100 text-emerald-800",
  WARN: "bg-amber-100 text-amber-800",
  BLOCK: "bg-red-100 text-red-800",
};

export function VerdictBadge({
  verdict,
  className = "",
}: {
  verdict: string;
  className?: string;
}) {
  // 未知の判定語（将来スコアリング側が band を増やした場合）は中立色で出す。
  // 「知らない値だから ALLOW にしておく」は絶対にやらない — 判定表示で
  // fail-open するとユーザーに嘘の安全を見せることになる。
  const style = VERDICT_STYLE[verdict] ?? "bg-zinc-200 text-zinc-800";
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-mono font-semibold ${style} ${className}`.trim()}
    >
      {verdict}
    </span>
  );
}
