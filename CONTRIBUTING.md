# Contributing to vet402

vet402 is an independent verification layer for the x402 agent-payment
economy: it **actually buys** what listed endpoints sell and publishes every
outcome with evidence. Read [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)
first — it is short and explains where everything lives.
日本語の概観は [docs/ja/README.md](./docs/ja/README.md)。

## Getting a full stack running

Fastest path (Docker, no local Node/Postgres needed). The image runs the
production build, so the boot-time env guard demands real secrets — generate
them once (this is a feature: the same guard that protects production runs on
your machine):

```bash
cat > .env.docker <<EOF
APP_ENV=production
API_KEY_PEPPER=$(openssl rand -hex 32)
DASHBOARD_SESSION_SECRET=$(openssl rand -hex 32)
ADMIN_SECRET=$(openssl rand -hex 32)
CRON_SECRET=$(openssl rand -hex 32)
BASE_RPC_URL=https://mainnet.base.org
EOF

docker compose up
# app on http://localhost:3000, Postgres on localhost:5433
```

Then push the schema into the compose Postgres once:

```bash
DATABASE_URL=postgres://vouch:vouch_dev@localhost:5433/vouch npm run db:push
```

Local Node development (hot reload):

```bash
cp .env.example .env.local     # set DATABASE_URL, DEV_API_KEY, secrets
npm install
./scripts/dev-setup.sh         # local Postgres + db:push
npm run dev
```

Sanity check: `curl http://localhost:3000/api/health`.

> **Schema-push guard:** `npm run db:push` runs `scripts/db-preflight.ts`
> first. Against a Neon host it refuses any database not named `vouch` —
> this prevents a real incident (a migration silently applied to the wrong
> database on the same host). Local/CI Postgres passes through.

## Before you open a PR

All three must be green — CI runs the same set:

```bash
npm run typecheck
npm run lint
npm test
```

DB-backed tests are skipped unless you point them at a scratch database
(never at anything you care about — they TRUNCATE):

```bash
createdb vet402_scratch_test
TEST_DATABASE_URL=postgres://localhost/vet402_scratch_test npm run test:db
```

## House rules (these are enforced by tests, not vibes)

- **Facts and opinions never mix.** Observatory surfaces publish only
  `pass / fail / unverified` with definitions — no composite scores, no
  evaluative language. If your change adds a public claim, it needs a
  denominator.
- **Fail-closed.** Malformed input is never a reason to spend money, skip a
  rate limit, or publish a verdict. New money-touching paths must go through
  the atomic reservation in `l1-runner.ts`, not around it.
- **Document API routes.** Every public route must appear in
  `docs/openapi.yaml` — a parity test fails otherwise.
- **Match the paper style.** Public pages follow the RFC-paper look
  (`doc-head`, `doc-title`, `sec-head` in `globals.css`). Don't invent a new
  visual language in one page.
- **Comments explain constraints, not history.** Write why the code must be
  this way; leave the changelog to git.

## Suggested first contributions

1. **Solana L0 probe support** — `ChainAdapter` extraction is planned
   (Phase 1); a clean seam between `l0-probe.ts` and viem-specific code is
   the first brick. Discuss in an issue first.
2. **More L2 conformance checks** — `checkL2` in `l1-runner.ts` is minimal
   and honest today (undeclared ≠ mismatch); structured-schema diffs for
   JSON responses are welcome.
3. **Observatory chart of daily pass-rate history** — the data is already in
   `x402_l0_probes`; the reader in `src/lib/observatory/reader.ts` is the
   place to aggregate (keep page and API computed from the same reader).

## Reporting security issues

Do not open a public issue for vulnerabilities in the purchase or scoring
path. See `docs/PENTEST_SCOPE.md` and contact the operator through the site.
