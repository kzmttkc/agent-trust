/**
 * VerdictBadge — ALLOW / WARN / BLOCK の唯一の表示体。
 *
 * 2026-08-11 UI監査: 判定語はこの製品で最も重要な1語なのに、扱いが4通りに
 * 割れていた。ホームだけが色付きピルで、/agent/[agentId]・/payee/[address]・
 * /leaderboard・/accuracy は素の等幅文字。同じ BLOCK が画面によって
 * 「赤いバッジ」だったり「ただの黒い文字」だったりする状態だった。ここへ集約する。
 *
 * 色はブランドの紺ではなく **意味色**（emerald/amber/red）を使う。判定は
 * ブランド表現ではなく信号であり、ブランド変更に追随させてはいけないため。
 * 2026-08-13 の vet402 全面改装でもここだけは配色を動かしていない。
 * いずれも Tailwind の 100/800 の組みで白地・地色ともに AA を満たす。
 *
 * 形だけは世界に合わせた（丸ピル → 角丸2pxの箱・等幅・字間 0.06em）。RFC 組版に
 * 丸いピルは無いが、意味色を紺へ寄せると判定が読めなくなるので色は据え置く。
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
  const style = VERDICT_STYLE[verdict] ?? "bg-ground text-brand-deep";
  return (
    <span
      className={`inline-block rounded-[2px] px-1.5 py-0.5 text-[0.6875rem] tracking-[0.06em] ${style} ${className}`.trim()}
    >
      {verdict}
    </span>
  );
}
