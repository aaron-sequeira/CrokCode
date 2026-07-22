# Deploying the CrokCode site to Vercel

The site is a static Vite build with no server. It talks to the Supabase Edge
Functions, which are already deployed. Deploying is just hosting `dist/`.

## Option A — Vercel dashboard (easiest, no CLI)

1. Push this repo to GitHub.
2. In Vercel: **Add New → Project → Import** the repo.
3. Set **Root Directory** to `packages/site`. Vercel reads `vercel.json` there
   (framework Vite, `vite build`, output `dist`, SPA rewrites).
4. Deploy. That's it — the site works immediately because the Supabase URL and
   publishable key are baked in as defaults.

## Option B — Vercel CLI

```bash
npm i -g vercel
cd packages/site
vercel            # first run links/creates the project — accept the detected Vite settings
vercel --prod     # production deploy
```

## Environment variables (optional)

The publishable key and URL are safe defaults in `src/lib/api.ts`, so the site
runs without any env vars. To point at a different Supabase project, set:

| Variable | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://<project>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | your `sb_publishable_...` key |

## After the first deploy — required for auth to work

Auth confirmation and password-reset links point at Supabase's **Site URL**, and
redirects are only allowed to listed URLs. In the Supabase dashboard
(**Authentication → URL Configuration**):

- **Site URL**: your Vercel URL (e.g. `https://crokcode.vercel.app`)
- **Redirect URLs**: add both the Vercel URL and `http://localhost:3000`

Checkout success/cancel URLs need no config — the `checkout` function derives
them from the request `origin`, which becomes your Vercel domain automatically.

## Stripe webhook (once, for billing to sync)

In the Stripe dashboard (test mode) add an endpoint:

- URL: `https://zapkpyjeetjbufuuqwye.supabase.co/functions/v1/stripe-webhook`
- Events: `checkout.session.completed`, `customer.subscription.created`,
  `customer.subscription.updated`, `customer.subscription.deleted`

The `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` gateway secrets are already set.
