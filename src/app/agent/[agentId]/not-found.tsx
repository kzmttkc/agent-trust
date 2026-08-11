import Link from "next/link";

// A-10 — AgentPage calls notFound() only when parseAgentId fails (a
// non-numeric agent id). A valid-but-unregistered agent still renders the
// profile ("has not registered a passport"). So the only way here is a
// malformed id; name the actual problem and offer a way forward.
export default function AgentNotFound() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-16 md:px-8">
      <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">Agent</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900">
        That is not a valid agent id
      </h1>
      <p className="mt-4 text-zinc-600">
        An agent passport URL is an ERC-8004 agent id — a whole number, e.g.{" "}
        <code className="rounded bg-zinc-100 px-1 text-zinc-700">/agent/42</code>.
      </p>
      <p className="mt-6 text-sm text-zinc-600">
        Check the id for a typo, then try again. You can also{" "}
        <Link href="/leaderboard" className="underline">
          browse recently verified agents
        </Link>{" "}
        or read{" "}
        <Link href="/docs/api" className="underline">
          how scoring works
        </Link>
        .
      </p>
    </main>
  );
}
