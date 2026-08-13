/**
 * TableScroll — the horizontal-scroll container every fact table sits in.
 *
 * 2026-08-13 アクセシビリティ監査（200%拡大・実効CSS幅 720px）。実測でこう
 * なっていた:
 *   - LP §2 の検証レベル表が 720px で 50px、640px で 66px 画面外に出て、
 *     `conform / mismat` `opinion — never m` と語の途中で切れていた。
 *   - `.table-scroll` には boxShadow / maskImage / ::after のいずれも無く、
 *     続きがある手掛かりがゼロだった。
 *   - docs のコードブロックには `role="region"` + `tabindex="0"` +
 *     `aria-label` が付いているのに、表側には3属性とも無い。Chromium は
 *     スクロール可能な要素を自動でフォーカス可能にするが、Safari と
 *     Firefox はしない — つまり両ブラウザではキーボードだけで隠れた列を
 *     読む手段が存在しなかった。同一サイト内で実装が割れていた。
 *
 * ここは3属性を CodeBlock と同じ形で配る1箇所。フェード（スクロール連動
 * シャドウ）は globals.css の .table-scroll 側にある。
 */
export function TableScroll({
  label,
  className = "",
  children,
}: {
  /** その表が何の表かを言う。スクリーンリーダのリージョン名になる。 */
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`table-scroll ${className}`.trim()}
      role="region"
      tabIndex={0}
      aria-label={label}
    >
      {children}
    </div>
  );
}

export default TableScroll;
