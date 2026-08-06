import Link from "next/link";

// 2026-08-06 (UX audit item 8): PayeePage calls notFound() only when the
// address fails isValidAddress — a valid-but-unregistered wallet still renders
// the profile page ("not registered a profile"). So the ONLY way to land here
// is a malformed address (e.g. /payee/0x123), and Next's bare default 404 gave
// no hint why. This boundary names the actual problem — wrong address shape —
// shows the correct form, and offers a way forward instead of a dead end.
export default function PayeeNotFound() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-16 md:px-8">
      <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">Payee</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900">
        That is not a valid wallet address
      </h1>
      <p className="mt-4 text-zinc-600">
        A payee profile URL must be a full Ethereum-style address: <code className="rounded bg-zinc-100 px-1">0x</code>{" "}
        followed by 40 hexadecimal characters (0-9, a-f) — 42 characters in total.
      </p>
      <div className="mt-6 rounded-xl border border-zinc-200 bg-zinc-50 p-5 text-sm">
        <p className="text-zinc-500">Correct form</p>
        <p className="mt-1 break-all font-mono text-zinc-800">
          /payee/0xd8da6bf26964af9d7eed9e03e53415d37aa96045
        </p>
      </div>
      <p className="mt-6 text-sm text-zinc-600">
        Check the address for a typo or a truncated copy-paste, then try again. You can also{" "}
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
