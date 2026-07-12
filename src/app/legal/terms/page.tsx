export default function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8 text-sm leading-relaxed text-zinc-700">
      <h1 className="text-3xl font-semibold text-zinc-900">Terms of Service</h1>
      <p>Last updated: July 2026</p>

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
          The service is provided &quot;as is&quot; without warranties. To the maximum extent
          permitted by law, we are not liable for losses arising from reliance on trust scores.
        </p>
      </section>
    </main>
  );
}
