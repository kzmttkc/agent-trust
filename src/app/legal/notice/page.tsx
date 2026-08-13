// Legal Notice — vet402's operator-disclosure page (2026-07-20; the product
// was renamed from Vouch in August 2026).
// vet402 is a pseudonymous, individually-operated Web3 product (mode B
// minimal disclosure, see legal_requirements.md). It is offered as a B2B
// API product (agent/service operators integrating trust scores), which is
// the primary reason full communication-sales disclosure (e.g. Japan's
// Act on Specified Commercial Transactions) does not currently apply — that
// statute governs consumer mail-order sales, not B2B API subscriptions.
// No live consumer billing exists yet either way. If/when that changes,
// a full disclosure block (entity name, address, phone) will be added here
// before any consumer-facing billing goes live, mirroring KoeWall's
// billing-flag-linked tokushoho pattern.
import type { Metadata } from "next";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "@/lib/support";

export const metadata: Metadata = {
  title: "Legal Notice | vet402",
  description: "Operator disclosure and contact information for vet402.",
};

export default function LegalNoticePage() {
  return (
    <main className="mx-auto max-w-3xl space-y-8 p-8 text-sm leading-relaxed text-zinc-700">
      <div>
        <h1 className="text-3xl font-semibold text-zinc-900">Legal Notice</h1>
        <p className="mt-2 text-zinc-500">Last updated: August 2026</p>
      </div>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-zinc-900">How vet402 is operated</h2>
        <p>
          vet402 (formerly known as Vouch) is developed and operated by an individual
          proprietor, trading as KIZUNA Creation. The product was renamed in August 2026; the
          operator, the service, and these pages are otherwise unchanged. It is offered as a business-to-business (B2B) API product for agent and
          service operators who need to verify agents before accepting payment — it is not
          marketed or sold as a consumer product.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-zinc-900">Why disclosure is minimal today</h2>
        <p>
          Because vet402 has no live consumer billing and is used B2B, statutes that require full
          public disclosure of the operator&apos;s legal name, home address, and phone number for
          consumer mail-order sales (such as Japan&apos;s Act on Specified Commercial
          Transactions) do not currently apply. We keep the operator&apos;s personal details out
          of this public page for the same reason many independent developers do — but we will
          disclose them without delay to anyone who requests it in good faith, and we will add a
          full disclosure block here before any consumer-facing billing goes live.
        </p>
      </section>

      <section id="contact" className="space-y-2">
        <h2 className="text-lg font-semibold text-zinc-900">Contact / disclosure requests</h2>
        <p>
          For support, billing questions, or to request operator disclosure details, email{" "}
          <a className="underline" href={SUPPORT_MAILTO}>
            {SUPPORT_EMAIL}
          </a>
          . We aim to respond within a few business days.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-zinc-900">Data handling</h2>
        <p>
          See the{" "}
          <a className="underline" href="/legal/privacy">
            Privacy Policy
          </a>{" "}
          for what we collect and how it is used, and the{" "}
          <a className="underline" href="/legal/terms">
            Terms of Service
          </a>{" "}
          for the terms of use.
        </p>
      </section>
    </main>
  );
}
