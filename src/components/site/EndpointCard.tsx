/**
 * EndpointCard — condensed API endpoint card for the marketing homepage
 * grid. Full request/response payloads live at /docs/api; this is a
 * scannable summary that links visitors there.
 */

export type EndpointCardProps = {
  method: "GET" | "POST";
  path: string;
  note: string;
  tag?: string;
};

export function EndpointCard({ method, path, note, tag }: EndpointCardProps) {
  const methodStyle =
    method === "GET" ? "bg-blue-100 text-blue-800" : "bg-purple-100 text-purple-800";

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${methodStyle}`}>{method}</span>
        <code className="break-all font-mono text-sm text-zinc-900">{path}</code>
        {tag && (
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
            {tag}
          </span>
        )}
      </div>
      <p className="mt-2 text-sm text-zinc-600">{note}</p>
    </div>
  );
}
