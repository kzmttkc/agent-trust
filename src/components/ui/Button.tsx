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

const BASE =
  "inline-flex items-center justify-center rounded-md transition-[background-color,border-color] disabled:opacity-60";

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
