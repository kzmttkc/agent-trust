/**
 * RFC-world loading skeleton. Server-safe: loading.tsx must not import a
 * "use client" module or every public wait state ships a client bundle.
 * Error panels live in DocRouteFallback.tsx (client, required by error.tsx).
 */
export function DocLoadingSkeleton({
  rows = 6,
  label,
}: {
  rows?: number;
  label: string;
}) {
  return (
    <main className="px-4 pt-8 pb-4 sm:px-6 md:px-8 md:pt-12" aria-busy="true" aria-live="polite">
      <div className="sheet" role="status">
        <span className="sr-only">{label}</span>
        <div className="doc-skel w-1/3" />
        <div className="doc-skel mt-4 w-2/3" />
        <div className="mt-8 flex flex-col items-center gap-3">
          <div className="doc-skel h-6 w-3/4 max-w-[42ch]" />
          <div className="doc-skel h-6 w-1/2 max-w-[30ch]" />
        </div>
        <div className="rule-double mx-auto mt-6 w-full max-w-[34ch]" />
        <div className="mt-8 space-y-3">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="doc-skel" style={{ width: `${85 - (i % 3) * 12}%` }} />
          ))}
        </div>
      </div>
    </main>
  );
}
