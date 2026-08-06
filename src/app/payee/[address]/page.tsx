import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { verifiedPayees } from "@/lib/db/schema";
import { isValidAddress } from "@/lib/chain/client";
import { scorePayeeWallet } from "@/lib/scoring/payee-engine";

// N-16 — public payee profile: verified identity claim + live payee score.
// The two-sided surface: spending agents check it, payees link it.
export const revalidate = 300;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ address: string }>;
}): Promise<Metadata> {
  const { address } = await params;
  return {
    title: `Payee ${address.slice(0, 10)}… — verified profile | Vouch`,
    description: "Verified x402 payee: signature-proven identity claim plus a live trust score.",
  };
}

export default async function PayeePage({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address } = await params;
  if (!isValidAddress(address)) notFound();
  const wallet = address.toLowerCase();

  const db = getDb();
  let entry: { name: string; url: string | null; verifiedAt: Date | null } | null = null;
  if (db) {
    try {
      const rows = await db
        .select()
        .from(verifiedPayees)
        .where(eq(verifiedPayees.wallet, wallet))
        .limit(1);
      if (rows[0]) entry = { name: rows[0].name, url: rows[0].url, verifiedAt: rows[0].verifiedAt };
    } catch {
      entry = null;
    }
  }

  let score: { value: number; recommendation: string; dataDepth: string } | null = null;
  try {
    const result = await scorePayeeWallet(wallet);
    score = { value: result.score, recommendation: result.recommendation, dataDepth: result.dataDepth };
  } catch {
    score = null;
  }

  return (
    <main className="mx-auto max-w-2xl px-5 py-16 md:px-8">
      <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">
        {entry ? "Verified payee" : "Payee"}
      </p>
      <h1 className="mt-2 break-all font-mono text-2xl font-semibold text-zinc-900">{wallet}</h1>
      {entry ? (
        <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-5">
          <p className="font-semibold text-emerald-900">{entry.name}</p>
          <p className="mt-1 text-sm text-emerald-800">
            Control of this wallet was proven by signature
            {entry.verifiedAt ? ` on ${entry.verifiedAt.toISOString().slice(0, 10)}` : ""}.
            {entry.url ? (
              <>
                {" "}
                Site:{" "}
                <a href={entry.url} rel="noopener noreferrer nofollow" target="_blank" className="underline">
                  {entry.url}
                </a>
              </>
            ) : null}
          </p>
          <p className="mt-2 text-xs text-emerald-700">
            Verification proves wallet control only — it is not an endorsement, and the score below
            is computed independently of it.
          </p>
        </div>
      ) : (
        <p className="mt-6 text-zinc-600">
          This wallet has not registered a verified-payee profile.{" "}
          <span className="text-zinc-500">
            Own it? POST a signed claim to <code className="rounded bg-zinc-100 px-1">/api/v1/payees/verify</code>{" "}
            — free, no API key, signature required.
          </span>
        </p>
      )}

      <div className="mt-8 rounded-xl border border-zinc-200 p-5">
        <p className="text-sm text-zinc-500">Live payee score</p>
        {score ? (
          // 2026-08-06 a11y (keyboard+screen-reader persona audit L5): the verdict
          // word used to be separated from the data-depth note by nothing but a
          // visual `ml-2` margin, so innerText read "37 BLOCKdata: thin" and the
          // verdict — the single most important word on this public, unauthenticated
          // page — was announced glued to the next string as "BLOCKdata".
          // Two fixes, both needed: real whitespace between the two elements, and
          // an explicit accessible name so "37" is not heard without its scale.
          // The role="img" + aria-label shape is deliberately the same one the
          // homepage gauge already uses ("Trust score 78 out of 100").
          <p className="mt-1 text-3xl font-semibold text-zinc-900">
            <span
              role="img"
              aria-label={`Trust score ${score.value} out of 100, recommendation ${score.recommendation}`}
            >
              {score.value} <span className="text-base font-mono">{score.recommendation}</span>
            </span>{" "}
            <span className="align-middle text-xs font-normal text-zinc-500">data: {score.dataDepth}</span>
          </p>
        ) : (
          <p className="mt-1 text-zinc-500">Score unavailable right now.</p>
        )}
        <p className="mt-2 text-xs text-zinc-500">
          {/* 2026-08-06 a11y (WCAG 2.4.4): the link text used to be the bare path
              "/accuracy", which reads as "slash accuracy" in a screen reader's
              link list. The descriptive phrase is now the link itself. */}
          <Link href="/accuracy" className="underline">Methodology and measured accuracy</Link>.
          {" "}
          {/* 2026-08-06 (320px persona audit A-3): this badge URL is ~65 chars of
              unbreakable token and overflowed the viewport by 110px on a 320px
              screen, taking the whole page into horizontal scroll. The wallet
              heading above already solves this with break-all — the same fix was
              simply missing here. */}
          Badge for your site: <code className="break-all rounded bg-zinc-100 px-1">/api/badge/{wallet}</code>
        </p>
      </div>
    </main>
  );
}
