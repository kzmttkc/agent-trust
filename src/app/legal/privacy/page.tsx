import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "@/lib/support";

export default function PrivacyPage() {
  return (
    <main className="px-4 pt-8 pb-4 sm:px-6 md:px-8 md:pt-12">
      <article className="sheet space-y-6 text-sm text-brand">
        <div className="doc-head">
          <div className="doc-head-col">
            <span>Independent Measurement</span>
            <span>Instrument: privacy policy</span>
            <span>
              {/* この頁のシアン1点。改訂日という事実。 */}
              Revision: <span className="text-signal">August 13, 2026</span>
            </span>
          </div>
          <div className="doc-head-col">
            <span>vet402</span>
            <span>x402 Economy</span>
            <span>August 2026</span>
          </div>
        </div>
        <h1 className="doc-title mt-10">Privacy Policy</h1>
        <div className="rule-double mx-auto mt-6 w-full max-w-[34ch]" />
        <p className="doc-note text-center">Last updated: August 13, 2026</p>

        <section className="space-y-2">
          <h2 className="sec-head">Contact / operator information</h2>
          <p>
            vet402 is operated by an individual proprietor. See our{" "}
            <a className="doc-link" href="/legal/notice">
              Legal Notice
            </a>{" "}
            for how operator disclosure works. Privacy questions or deletion requests:{" "}
            <a className="doc-link" href={SUPPORT_MAILTO}>
              {SUPPORT_EMAIL}
            </a>
            .
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="sec-head">Data we collect</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>Account email address</li>
            <li>API usage logs (agent IDs, wallet addresses queried, scores returned)</li>
            <li>Customer whitelist/blacklist entries you configure</li>
            <li>Billing metadata via Stripe (we do not store card numbers)</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="sec-head">Wallet addresses</h2>
          <p>
            Wallet addresses are public blockchain identifiers. We treat them as pseudonymous data
            and do not intentionally collect direct personal identifiers beyond your email.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="sec-head">Retention</h2>
          <p>
            Query logs are retained per your plan (90 days Free, 1 year Pro+). You may request
            deletion of your account by contacting support.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="sec-head">Third parties</h2>
          <p>
            We use infrastructure providers (hosting, database, RPC, Stripe) to operate the service.
            Data is processed according to their respective policies.
          </p>
          {/* 2026-08-06 audit: the site loads Plausible and the CSP explicitly
              allows connect-src to plausible.io, i.e. we were sending analytics
              events while this list did not mention analytics at all. Disclosed
              now. Plausible is cookieless and does not collect personal data,
              but the omission was still a gap between what we do and what we
              say. */}
          <p>
            We use Plausible Analytics for aggregate traffic statistics. Plausible is
            cookieless, sets no persistent identifier, and does not collect personal data or track
            visitors across sites.
          </p>
        </section>

        {/* 2026-08-06 (L4 legal review): the policy named deletion as the only
            right and said nothing about where data physically sits. Both are
            baseline expectations under GDPR/APPI-style regimes, and the storage
            question is the first one a procurement reviewer asks. The hosting
            region is deliberately not asserted here — the operator has not
            measured which region the Vercel/Neon projects are pinned to, and a
            privacy policy is the wrong place to guess. Naming the providers and
            offering the exact region on request is accurate today; replace this
            with the measured region once it is confirmed. */}
        <section className="space-y-2">
          <h2 className="sec-head">Where your data is stored</h2>
          <p>
            vet402 is hosted on Vercel, with its database on Neon — both are US-headquartered
            providers — and the operator administers the service from Japan. Your data is therefore
            stored and accessed outside your own country in most cases, and personal data
            originating in the EEA or UK may be transferred to and processed in third countries. We
            rely on our providers&apos; standard data-processing terms, including standard
            contractual clauses where they apply, for those transfers. If you need the specific
            hosting region confirmed in writing before approving vet402 internally, ask us by email
            and we will tell you.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="sec-head">Your rights over your data</h2>
          <p>
            Depending on where you are, you may have the right to <strong>access</strong> the
            personal data we hold about you, to have it <strong>corrected</strong> if it is wrong,
            to have it <strong>deleted</strong>, to <strong>object to</strong> or ask us to{" "}
            <strong>restrict</strong> a particular use of it, to receive it in a{" "}
            <strong>portable</strong> format, and to <strong>withdraw consent</strong> where we
            relied on consent. We do not make automated decisions with legal or similarly
            significant effects about you as a user of this site.
          </p>
          <p>
            To exercise any of these, email{" "}
            <a className="doc-link" href={SUPPORT_MAILTO}>
              {SUPPORT_EMAIL}
            </a>{" "}
            from the address on the account, or tell us which address it was. One person reads that
            inbox; we aim to acknowledge within 5 business days (Japan time) and to complete the
            request within 30 days. There is no charge. We will say no only where the law lets us —
            for example where we must keep billing records for tax purposes — and we will say which
            exception we are relying on rather than just declining. If you are unhappy with how we
            handled it, you can complain to your local data-protection authority.
          </p>
          <p>
            Two things we cannot do, and would rather say plainly than leave you to discover.
            First, we cannot erase the blockchain: wallet addresses and their transaction history
            are public records on Base that we read, not records we created or control, so deleting
            your vet402 account does not remove anything from the chain. Second, if you believe a
            trust <em>score</em> about an address is wrong — which is a different problem from a
            privacy request — the route for that is in{" "}
            <a className="doc-link" href="/legal/terms">
              section 8 of the Terms
            </a>
            : it is free, needs no account, and works whether or not you are a customer.
          </p>
        </section>
      </article>
    </main>
  );
}
