# vet402 — two visual worlds

Do not mix these. A public page that looks like the dashboard, or a dashboard that looks like an RFC, is a product error.

## Public (IETF RFC)

Navy / paper. Martian + Fragment Mono. Running head, sheet, `doc-head`, `doc-title`, `rule-double`, numbered sections. Copy is facts with timestamps.

Applies to: the memo, observatory, methodology, FAQ, docs, legal, blog, `/payee`, `/agent`, 404s.

The approved LP memo body and hero (Abstract + two CTAs: “Read the methodology” / “Verify a payee now”) are not to be redesigned.

## Operate (dashboard)

Zinc SaaS. Stripe / Linear / Vercel density. Sidebar, cards, forms, live regions on errors. This world stays zinc on purpose.

Applies to: `/dashboard/*` including login.

## Visual direction

Lettering and tokens live in `src/app/globals.css` and the self-hosted fonts. If you need a named Impeccable world, run `/impeccable init` against the shipped public artifact — do not invent a second brand from a prompt.
