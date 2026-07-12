export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8 text-sm leading-relaxed text-zinc-700">
      <h1 className="text-3xl font-semibold text-zinc-900">Privacy Policy</h1>
      <p>Last updated: July 2026</p>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-zinc-900">Data we collect</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Account email address</li>
          <li>API usage logs (agent IDs, wallet addresses queried, scores returned)</li>
          <li>Customer whitelist/blacklist entries you configure</li>
          <li>Billing metadata via Stripe (we do not store card numbers)</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-zinc-900">Wallet addresses</h2>
        <p>
          Wallet addresses are public blockchain identifiers. We treat them as pseudonymous data
          and do not intentionally collect direct personal identifiers beyond your email.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-zinc-900">Retention</h2>
        <p>
          Query logs are retained per your plan (90 days Free, 1 year Pro+). You may request
          deletion of your account by contacting support.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-zinc-900">Third parties</h2>
        <p>
          We use infrastructure providers (hosting, database, RPC, Stripe) to operate the service.
          Data is processed according to their respective policies.
        </p>
      </section>
    </main>
  );
}
