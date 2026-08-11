/**
 * Button — the app's only button/CTA styling source.
 *
 * 2026-08-11 UI監査: 同じ「主ボタン」が page.tsx(hero: px-6 py-3 text-base
 * font-semibold / final: px-5 py-2.5 text-sm font-medium)・SiteHeader(px-4 py-2)・
 * signup(px-4 py-2 ×2) で 3サイズ3ウェイトに散らばっていた。ここへ2段
 * (sm / md) × 2系統 (primary / secondary) へ畳む。
 *
 * 呼び出し側は next/link・TrackedLink・<button> と要素がまちまちなので、
 * コンポーネント本体ではなく **クラス文字列を返す buttonClass()** を主API
 * にしている（要素を差し替えずに見た目だけ揃えられる）。
 *
 * transition を明示列挙しているのは 2026-08-06 の a11y 修正の維持:
 * Tailwind v4 の `transition` / `transition-colors` は outline-color を含むため、
 * 濃色ボタンのフォーカスリングが白から150msかけてフェードインし、キーボード
 * ユーザーがそれを必要とするまさにその瞬間に不可視だった。
 */

export type ButtonVariant = "primary" | "secondary";
export type ButtonSize = "sm" | "md";

// 2026-08-12: disabled は `opacity-60` をやめて、専用の地色・輪郭・文字色で表す。
//
// 理由は /signup の初回描画。`disabled={pending || !acceptedTerms}` で acceptedTerms
// の初期値が false なので、**全訪問者が最初に見る状態**が disabled の「Create account」
// だった。opacity-60 は紺(#233456)を白に溶かして白文字を実描画 3.76:1 まで薄めるので、
// 収益動線の主CTAが「壊れている／読み込み中」に見える。WCAG 1.4.3 は無効化された
// 部品を免除しているので不合格ではない（＝これは登録率の判断であって是正義務ではない）。
//
// opacity は「全部を等しく薄める」ので、押せないことを伝える代わりに読みにくさまで
// 一緒に買ってしまう。地色を zinc-100・文字を zinc-600 (7.03:1) にすると、押せない
// ことは紺→灰の色相変化で伝わる。輪郭に zinc-300 を1本引くのは、塗り(zinc-100 は
// 白地 1.10:1)だけではボタンの形そのものが消えてしまうため。無効化部品は 1.4.11 の
// 対象外なので、この輪郭に 3:1 は要求されない。
//
// 輪郭が border ではなく ring なのは実測の結果。`disabled:border` で試したところ、
// primary は有効時に border を持たないため、同意チェックを入れた瞬間にボタンの高さが
// 38px → 36px と 2px 跳ねた（box-sizing: border-box なので border 分が内側を削る）。
// ring は box-shadow なのでレイアウトに影響しない。
//
// 同意ゲート自体（checkbox の `required`）には触れていない。
const BASE =
  "inline-flex items-center justify-center rounded-md transition-[background-color,border-color] disabled:bg-zinc-100 disabled:text-zinc-600 disabled:ring-1 disabled:ring-zinc-300";

const SIZES: Record<ButtonSize, string> = {
  sm: "px-4 py-2 text-sm font-medium",
  md: "px-6 py-3 text-base font-semibold",
};

const VARIANTS: Record<ButtonVariant, string> = {
  // 白文字 on #233456 = 12.37:1。hover は同じ紺階調の1段明るい #3e537c(7.68:1)。
  primary: "bg-brand-deep text-white hover:bg-brand",
  // 罫線は brand-mist（文字を載せない階調）、文字は brand-deep。
  secondary: "border border-brand-mist bg-white text-brand-deep hover:bg-zinc-50",
};

export function buttonClass({
  variant = "primary",
  size = "sm",
  className = "",
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
} = {}): string {
  return [BASE, SIZES[size], VARIANTS[variant], className].filter(Boolean).join(" ");
}

export function Button({
  variant,
  size,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return <button {...props} className={buttonClass({ variant, size, className })} />;
}
