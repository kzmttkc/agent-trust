/**
 * Wordmark — "vet402" set in Martian Mono, 400 for "vet" and 700 for "402",
 * tracking -0.02em (brand sheet, assets/README.md "書体").
 *
 * Live text rather than an image: the site self-hosts the face, and a wordmark
 * that is real text stays crisp at every zoom level, gets selected and copied
 * as "vet402", and is read as one word by a screen reader.
 */

export function Wordmark({
  className = "",
  tone = "light",
}: {
  className?: string;
  /** light = on paper, dark = on the navy field */
  tone?: "light" | "dark";
}) {
  const vet = tone === "dark" ? "text-brand-mist" : "text-brand";
  const num = tone === "dark" ? "text-white" : "text-brand-deep";
  return (
    <span
      className={`font-[family-name:var(--font-display)] tracking-[-0.02em] ${className}`}
      style={{ fontFeatureSettings: '"kern" 1' }}
    >
      <span className={`font-normal ${vet}`}>vet</span>
      <span className={`font-bold ${num}`}>402</span>
    </span>
  );
}
