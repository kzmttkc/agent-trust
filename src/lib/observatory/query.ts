export type ObservatoryVerdict = "pass" | "fail" | "unverified";

export type ObservatoryQuery = {
  page: number;
  pageSize: number;
  q: string | null;
  verdict: ObservatoryVerdict | null;
  network: string | null;
};

const VERDICTS = new Set<ObservatoryVerdict>(["pass", "fail", "unverified"]);
const NETWORK_RE = /^[a-z0-9:-]{1,40}$/i;

export function parseObservatorySearchParams(
  params: Record<string, string | undefined>,
): ObservatoryQuery {
  const page = Math.max(1, Math.trunc(Number.parseFloat(params.page ?? "1")) || 1);
  const requestedSize = Math.trunc(Number.parseFloat(params.pageSize ?? "40")) || 40;
  const pageSize = Math.min(Math.max(requestedSize, 1), 100);

  const rawQ = (params.q ?? "").trim().replace(/[%_\\]/g, "").slice(0, 80);
  const q = rawQ.length > 0 ? rawQ : null;

  const rawVerdict = params.verdict ?? "";
  const verdict = VERDICTS.has(rawVerdict as ObservatoryVerdict)
    ? (rawVerdict as ObservatoryVerdict)
    : null;

  const rawNetwork = (params.network ?? "").trim();
  const network = NETWORK_RE.test(rawNetwork) ? rawNetwork : null;

  return { page, pageSize, q, verdict, network };
}
