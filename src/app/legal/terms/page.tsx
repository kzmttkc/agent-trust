import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "@/lib/support";

/**
 * Terms of Service.
 *
 * 2026-08-06 (L4 legal review). Sections 0-5 were the whole document and left
 * three gaps that mattered more for Vouch than for a normal B2B API:
 *
 *  1. No governing law, no venue, no dispute process at all.
 *  2. Liability was one sentence ("not liable for losses arising from
 *     reliance on trust scores") with no cap and no damage types named, and
 *     there was no indemnity.
 *  3. Nothing addressed non-customers. This is the structural one. Section 2
 *     puts the allow/warn/block decision on the customer, but section 2 only
 *     binds the customer. The people most likely to be hurt by a wrong score
 *     — a payee wrongly BLOCKed out of a payment, or someone defrauded after
 *     a wrong ALLOW — have no contract with us, so no contractual disclaimer
 *     reaches them. /faq advertises both directions of use, so this is not
 *     hypothetical. Sections 6-8 below address it directly: scores are stated
 *     as opinion rather than as fact about a person, third-party beneficiary
 *     status is disclaimed, no duty of care is assumed toward non-customers,
 *     and — the part that actually reduces the risk rather than just
 *     disclaiming it — a free, key-less correction route is published for
 *     anyone who thinks a score about them is wrong.
 *
 * Voice follows Verilot's ToS (same operator): plain English that explains
 * why a clause exists rather than reciting boilerplate. Existing section
 * numbers 0-5 are unchanged so anything citing them still resolves; the new
 * material is appended as 6-12.
 */

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8 text-sm leading-relaxed text-zinc-700">
      <h1 className="text-3xl font-semibold text-zinc-900">Terms of Service</h1>
      <p>Last updated: August 6, 2026</p>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-zinc-900">0. Business use only</h2>
        <p>
          Vouch is offered for business-to-business (B2B) use by agent and service operators
          integrating trust scores into their own products. It is not marketed or sold to
          consumers for personal use. See our{" "}
          <a className="underline" href="/legal/notice">
            Legal Notice
          </a>{" "}
          for operator and contact information.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-zinc-900">1. Service</h2>
        <p>
          Vouch provides agent trust scores and recommendations for informational purposes only.
          Scores do not constitute a guarantee, credit assessment, investment advice, or legal
          certification.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-zinc-900">2. Your responsibility</h2>
        <p>
          You are solely responsible for decisions to allow, warn, or block agents or wallets
          based on Vouch output. Final access control remains with you.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-zinc-900">3. API keys</h2>
        <p>
          Keep API keys confidential. You are responsible for usage under your account, including
          quota consumption across all keys you create.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-zinc-900">4. Acceptable use</h2>
        <p>
          Do not abuse the API, attempt to circumvent rate limits, or use the service for unlawful
          activity. We may suspend accounts that violate these terms.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-zinc-900">5. Disclaimer</h2>
        <p>
          The service is provided &quot;as is&quot; and &quot;as available,&quot; without
          warranties of any kind, express or implied, including accuracy, completeness,
          merchantability, or fitness for a particular purpose. Scores are computed from public
          on-chain data and third-party sources we do not control, which can be incomplete,
          delayed, throttled, or wrong. Nothing we publish about how well the scores have
          performed in the past — including the figures on{" "}
          <a className="underline" href="/accuracy">
            /accuracy
          </a>{" "}
          — is a promise about how they will perform on your traffic. What we will and will not
          pay for if something goes wrong is in section 9.
        </p>
      </section>

      {/* --- 6-8: the non-customer sections. See the file header for why. --- */}

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-zinc-900">
          6. What a score is — and what it is not
        </h2>
        <p>
          A Vouch score is our <strong>opinion</strong>, expressed as a number and a
          recommendation, about the risk profile of a blockchain address or an ERC-8004 agent
          identifier, based on data that is already public on-chain. It is not a statement of fact
          about any person or business, and it is not an accusation. A low score does not say
          that anyone is a fraudster, a criminal, insolvent, or untrustworthy as a person; it says
          that the public record attached to that address, read through our published
          methodology, looks risky to us on the day we read it.
        </p>
        <p>
          A score is also not identity verification, KYC/AML screening, a sanctions check, a
          credit assessment, a background check, or any kind of certification or accreditation.
          Addresses are pseudonymous: the same address may be controlled by different parties over
          time, one party may control many addresses, and we generally do not know who is behind
          any of them.
        </p>
        <p>
          ALLOW, WARN, and BLOCK are <strong>recommendations to the customer who asked</strong>,
          not instructions and not decisions. Vouch never accepts, refuses, delays, or reverses
          anyone&apos;s payment — we have no custody, no signing authority, and no place in the
          transaction. If a payment of yours was refused, or accepted and then went wrong, the
          decision was made by the business you were transacting with, applying its own policy.
          Section 2 puts that responsibility on our customers in so many words, and we are
          repeating it here so that it is legible to someone who is not our customer and never
          agreed to these terms.
        </p>
        <p>
          Our methodology, and our own measured error rates including the false positives that
          make us look bad, are published at{" "}
          <a className="underline" href="/accuracy">
            /accuracy
          </a>
          . We publish them because a score that presents itself as infallible is the more
          dangerous product.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-zinc-900">
          7. No third-party beneficiaries, and no duty to non-customers
        </h2>
        <p>
          These terms are an agreement between us and the customer who holds the API key. Nobody
          else acquires rights under them. In particular, a person or business that is
          <em> scored</em> by Vouch, or that is on the other side of a transaction where our
          customer used Vouch, is not a party to this agreement and is not an intended third-party
          beneficiary of it. Our customers cannot promise, on our behalf, that a score is accurate,
          current, or fit for anything.
        </p>
        <p>
          To the fullest extent permitted by applicable law, we do not accept and do not assume a
          duty of care toward people who are not our customers. We do not investigate the parties
          behind the addresses we score, we do not adjudicate disputes between a payer and a
          payee, and we do not undertake to protect any particular party from loss. If you are not
          our customer and a score affected you, our undertaking to you is the correction route in
          section 8 — a real one, free and open to anyone — and not an assurance of any outcome.
        </p>
        <p>
          Nothing in this section is an attempt to escape liability for our own fraud,
          intentional misconduct, or gross negligence, or for anything that applicable law does
          not allow to be excluded. Those remain exactly where the law puts them.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-zinc-900">
          8. If you think a score about you is wrong
        </h2>
        <p>
          You do not need an account, an API key, a payment, or a lawyer to challenge a score. Two
          routes, both free:
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Prove control of the address.</strong> Sign our canonical message with the
            wallet in question and{" "}
            <code className="rounded bg-zinc-100 px-1 text-zinc-700">POST /api/v1/payees/verify</code>. A valid
            signature is the proof — no key required, no charge. That registers you as a verified
            payee, publishes a profile at{" "}
            <code className="rounded bg-zinc-100 px-1 text-zinc-700">/payee/&lt;address&gt;</code>, and feeds
            back into how the address is scored.{" "}
            <a className="underline" href="/docs/api">
              The API reference
            </a>{" "}
            shows the exact request, and a GET on the same path returns the message to sign before
            you attempt anything.
          </li>
          <li>
            <strong>Or just email us.</strong> Write to{" "}
            <a className="underline" href={SUPPORT_MAILTO}>
              {SUPPORT_EMAIL}
            </a>{" "}
            with the address and what you think is wrong. One person reads that inbox. We will
            acknowledge within 5 business days (Japan time). We cannot promise to change a score —
            it is our opinion, and sometimes we will disagree with you — but we will look, we will
            tell you what we concluded, and if we got a fact wrong we will fix it and re-score.
          </li>
        </ul>
        <p>
          If you intend to bring a claim about a score, please use one of those routes first and
          give us 30 days. This is not a waiver of any right and it does not stop any clock that
          the law is running; it is a request, because most of these are fixable in an afternoon
          and neither of us wants the alternative.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-zinc-900">9. Limitation of liability</h2>
        <p>
          To the fullest extent permitted by applicable law, we are not liable for indirect,
          incidental, special, consequential, exemplary, or punitive damages, or for lost profits,
          lost revenue, lost or corrupted data, lost business, business interruption, loss of
          goodwill or reputation, or the cost of substitute services — whether the claim is
          framed in contract, in tort (including negligence), or otherwise, and whether or not we
          were told such damages were possible. This includes losses from a payment you accepted
          after an ALLOW, a payment or counterparty you turned away after a WARN or BLOCK, and
          funds sent to a wallet that scored well and misbehaved anyway.
        </p>
        <p>
          Our total liability for all claims relating to Vouch, taken together, will not exceed
          the greater of (a) the amount you paid us for the service in the twelve months before
          the claim and (b) US$100 (or its equivalent in Japanese yen). On the Free plan (a) is
          zero, so the US$100 floor is what applies. On Pro that ceiling is at most US$588, and on
          Scale at most US$2,388.
        </p>
        <p>
          We would rather state that plainly than bury it. Vouch is run by one person and priced
          between US$0 and US$199 a month; it cannot carry exposure larger than the revenue an
          account actually produced, and pretending otherwise would be a promise we could not
          keep. Size your reliance accordingly: if a single wrong verdict would cost you more than
          the cap, Vouch should be one input into your decision and not the decision. If you need
          cover beyond this, talk to us <em>before</em> you build it into a payment path — the
          answer may be no, but you will have it in writing and in advance.
        </p>
        <p>
          Nothing in these terms limits or excludes liability that cannot be limited or excluded
          under the law that applies to you — including liability for fraud or fraudulent
          misrepresentation, for our own intentional misconduct or gross negligence, or for death
          or personal injury. Vouch is offered for business use only (section 0), so this section
          is written for a business counterparty rather than a consumer; if mandatory
          consumer-protection rules nonetheless apply to you, they apply whether or not this
          document says so, and this section takes effect only as far as those rules allow.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-zinc-900">10. Your responsibility to us</h2>
        <p>
          If a third party brings a claim against us because of how you used Vouch — because you
          used it unlawfully or in breach of these terms, because you presented a score as
          something it is not (a certification, a fraud determination, a KYC or sanctions result,
          a statement of fact about a person), because you republished or resold score output in a
          way these terms do not permit, or because of a decision you made to allow, warn, or
          block someone — you agree to cover the direct costs we reasonably incur from that claim,
          including reasonable legal fees. This does not apply to anything caused by our own act
          or omission, and it is limited to what applicable law allows. We will tell you promptly
          about any such claim, will not settle it without asking you first, and will let you take
          over the defense if you want it.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-zinc-900">
          11. Governing law, venue, and language
        </h2>
        <p>
          These terms, and any dispute arising out of them or out of your use of Vouch — including
          non-contractual disputes — are governed by the laws of Japan, without regard to
          conflict-of-law rules. That is because the operator is an individual proprietor
          established in Japan; the product being about on-chain payments between parties anywhere
          in the world does not change where its operator sits.
        </p>
        <p>
          For any dispute that reaches a court, the Japanese district court with jurisdiction over
          the operator&apos;s principal place of business will be the exclusive court of first
          instance. Vouch is a B2B service (section 0), so this is written as a
          business-to-business venue clause and there is no consumer carve-out; if you are
          somehow using Vouch in a capacity where mandatory local rules give you a forum in your
          own country, those rules apply on their own terms regardless of this clause. If you need
          to know the specific court by name before you can approve Vouch internally, ask us by
          email and we will tell you in writing.
        </p>
        <p>
          Before starting formal proceedings, please email us and give us 30 days to sort it out.
          One person reads that inbox and answers. These terms contain no mandatory arbitration
          clause and no class-action waiver — we are not asking you to sign away a forum.
        </p>
        <p>These terms are written in English, and the English text governs.</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-zinc-900">12. Changes, and the rest</h2>
        <p>
          We may update these terms as the product changes. Material changes will be reflected on
          this page with an updated date before they take effect; continuing to use Vouch after
          that means the updated terms apply. If any part of these terms turns out to be
          unenforceable, the rest stays in force and that part is read as narrowly as needed to
          make it valid. If we do not enforce something immediately, we have not given it up.
          Sections 5 through 11 survive after you stop using the service. Together with the{" "}
          <a className="underline" href="/legal/privacy">
            Privacy Policy
          </a>
          , these terms are the whole agreement between you and us about Vouch. You may not
          transfer your rights under them; we may transfer ours if the project moves to a company
          or is acquired, and we will say so on this page if that happens.
        </p>
        <p>
          Questions about these terms? Email{" "}
          <a className="underline" href={SUPPORT_MAILTO}>
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </section>
    </main>
  );
}
