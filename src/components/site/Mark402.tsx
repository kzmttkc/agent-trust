/**
 * Mark402 — the vet402 mark, drawn as vectors.
 *
 * Grammar (brand sheet, output/0813/brand_vet402/assets/README.md rule 3):
 * corner plus glyphs + dashed rules + 402. The rules are drawn as vectors, not
 * typed as box-drawing characters, so they hold their weight at any size.
 *
 * Geometry is copied from the approved 512 master (mark.svg / the hero mark in
 * vet402_rfc_plaintext.html) rather than re-derived, so the on-page mark and the
 * shipped favicon/OG assets are the same object.
 *
 * The "402" is set in Martian Mono 700 as live text — not outlined — because
 * this file is rendered by the same document that self-hosts the face. The
 * standalone SVG assets in public/brand/ keep their outlined copies for use
 * where the face is not loaded.
 */

export function Mark402({
  size = 160,
  animate = false,
  className = "",
}: {
  size?: number;
  animate?: boolean;
  className?: string;
}) {
  const edge = animate ? "mark-edge" : undefined;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      fill="none"
      role="img"
      aria-label="vet402"
      className={className}
    >
      <g stroke="#233456" strokeWidth={13}>
        {/* corner plus glyphs */}
        <path d="M34 64H94M64 34V94" />
        <path d="M418 64H478M448 34V94" />
        <path d="M34 448H94M64 418V478" />
        <path d="M418 448H478M448 418V478" />
        {/* dashed edges — hyphen / pipe grammar. The dash period is 44 units, and
            the settle animation travels exactly 3 periods, so the resting frame
            is identical to the first frame: nothing appears, it only comes to
            rest. */}
        <path className={edge} d="M112 64H400" strokeDasharray="27 17" />
        <path className={edge} d="M112 448H400" strokeDasharray="27 17" />
        <path className={edge} d="M64 112V400" strokeDasharray="27 17" />
        <path className={edge} d="M448 112V400" strokeDasharray="27 17" />
      </g>
      <text
        x={256}
        y={256}
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="var(--font-martian)"
        fontWeight={700}
        fontSize={140}
        fill="#233456"
      >
        402
      </text>
    </svg>
  );
}
