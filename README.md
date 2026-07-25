# areyoustillreading

Personal site + technical blog + owned audience + per-post paywall — a **static-first
full-stack app**. Live at **https://areyoustillreading.dev**.

This README is the single source of truth for the whole system. It is intentionally
exhaustive: you should be able to return after two years and rebuild your mental model
from this document alone. Pair it with [`PLAN.md`](PLAN.md) (the why/decisions) and the
per-file doc comments (the how, in each file).

---

## 1. What this is

A personal platform with three jobs, in priority order:

1. **Portfolio** — resume (`/resume`) + downloadable PDF, projects (`/projects`).
2. **Technical blog** — Markdown posts with code highlighting, math, and diagrams.
3. **Owned audience + monetization** — email list, reader accounts, engagement
   features, and a per-post paywall.

The site is **static by default** (great for SEO/speed/cost) and adds server behavior
only where required, via **Cloudflare Pages Functions**. There is no traditional server.

---

## 2. Architecture at a glance

```
Browser ──> Cloudflare Pages (static HTML/CSS/JS built by Astro)
   │            │
   │            ├── /api/*          Pages Functions (serverless)  ─┐
   │            └── /gated/*        gated static + _middleware     │
   │                                                               ▼
   ├── Supabase JS client (browser) ───────────────>  Supabase (Postgres + Auth)
   │        (anon key + user JWT, RLS enforced)         - RLS-locked tables
   │                                                     - Auth (magic-link + GitHub)
   ├── Turnstile widget ───────────> Cloudflare Turnstile (bot check)
   └── Dodo hosted checkout ───────> Dodo Payments (Merchant of Record)
                                          │ webhook
                                          ▼
                                   /api/dodo-webhook ──> writes entitlements (Supabase)
```

- **Front end:** Astro 7, static output. Browser talks to Supabase directly with the
  **public anon key** — safe because every table is protected by **Row-Level Security**.
- **Server bits:** Cloudflare Pages Functions (in `functions/`) use the **service-role
  key** for privileged work (sending email, verifying tokens, writing entitlements) and
  the `/gated/*` middleware enforces the paywall server-side.
- **Data + auth:** Supabase (Postgres via PostgREST + Supabase Auth).
- **Email:** Resend (transactional confirm emails, and Supabase's SMTP for auth emails).
- **Payments:** Dodo Payments (chosen because **Stripe is not generally available in
  India**; Dodo is a Merchant of Record → handles global tax + pays out to India).

---

## 3. Tech stack

| Area | Choice | Notes |
| --- | --- | --- |
| Generator | **Astro 7** (static) | Per-route server rendering available later without a rewrite. |
| Markdown | `@astrojs/markdown-remark` | **Required** in Astro 7 — its default "Sätteri" processor doesn't run remark/rehype plugins; installing this restores the unified pipeline. |
| Highlighting | **Shiki** (dual light/dark) | Built into Astro; configured in `astro.config.mjs`. |
| Math | **KaTeX** (`remark-math` + `rehype-katex`) | Rendered at build; CSS imported in `BlogPost.astro`. |
| Diagrams | **Mermaid** (`rehype-mermaid`, inline-svg) | **Build-time** via Playwright/Chromium → zero client JS. See deploy caveat. |
| Search | **Pagefind** | Postbuild step over `dist/`; UI on `/blog`. |
| Feeds/SEO | `@astrojs/rss`, `@astrojs/sitemap`, `astro-og-canvas` | RSS at `/rss.xml`, sitemap, per-post OG images at `/og/<id>.png`. |
| Auth/DB | **Supabase** (`@supabase/supabase-js`) | Postgres + Auth; RLS everywhere. |
| Email | **Resend** | Confirm emails via `lib/email.js`; also Supabase Auth SMTP. |
| Bot check | **Cloudflare Turnstile** | On the subscribe form; verified server-side. |
| Payments | **Dodo Payments** | Hosted checkout + Standard-Webhooks-verified webhook. |
| Host | **Cloudflare Pages** | Static assets + Functions. Deployed via Wrangler direct upload. |
| Tests | **Vitest** | Builds the site, then asserts on the emitted `dist/`. |

---

## 4. Project structure

```
areyoustillreading/
├── astro.config.mjs        Astro config: site URL, sitemap (excludes /gated/), markdown
│                           (Shiki dual theme, remark-math, rehype-katex, rehype-mermaid)
├── vitest.config.ts        Vitest: global setup builds the site, then tests read dist/
├── package.json            scripts: dev / build (astro build + pagefind) / preview / test / deploy
├── PLAN.md                 Living plan + every major decision (read for the "why")
│
├── public/                 Copied verbatim to the site root
│   ├── _headers            Cloudflare security headers (nosniff, HSTS, frame DENY, referrer)
│   ├── robots.txt          points at the sitemap
│   ├── favicon.svg
│   └── resume.pdf          served but GIT-IGNORED (the owner's CV; kept out of the public repo)
│
├── src/
│   ├── content.config.ts   Blog content collection + zod frontmatter schema
│   ├── content/blog/*.md    the posts (filename = URL slug)
│   ├── styles/global.css   design tokens + base styles (light/dark via prefers-color-scheme)
│   ├── layouts/
│   │   ├── BaseLayout.astro  html shell, nav, <BaseHead>, RSS link; takes {title,description,image}
│   │   └── BlogPost.astro    post shell: meta, tags, reading time; slots body; mounts Highlights/Notes/Comments
│   ├── components/
│   │   ├── BaseHead.astro    <head>: title, description, canonical, OpenGraph + Twitter tags
│   │   ├── SubscribeForm.astro  email capture form (+ Turnstile widget, honeypot)
│   │   ├── Comments.astro    public comments (per post)
│   │   ├── Highlights.astro  private highlights + in-blog marks + reader↔admin discussion
│   │   ├── Notes.astro       private per-reader note (one per post)
│   │   └── PaywallGate.astro  preview + unlock + admin "Add/Remove from paywall" + gated fetch
│   └── pages/
│       ├── index.astro       home (hero, latest posts, subscribe)
│       ├── blog/index.astro  post listing + Pagefind search UI
│       ├── blog/[...slug].astro  a post: full <Content/> OR (if gateable) <PaywallGate/>
│       ├── blog/tags/…        tag index + per-tag pages
│       ├── gated/[...slug].astro  FULL body of gateable posts — a bare fragment, no-index
│       ├── og/[...route].ts   dynamic OG PNGs (astro-og-canvas)
│       ├── rss.xml.js         RSS feed endpoint
│       ├── resume.astro, projects.astro
│       ├── login.astro, account.astro   Supabase auth UI
│       └── check-inbox / subscribed / unsubscribed / subscribe-error / 404
│
├── functions/              Cloudflare Pages Functions (server-side; see §9)
│   ├── api/subscribe.js  confirm.js  unsubscribe.js   (email list)
│   ├── api/checkout.js  dodo-webhook.js               (payments)
│   └── gated/_middleware.js                           (paywall enforcement on /gated/*)
│
├── lib/email.js            shared helpers for the email Functions (Supabase REST, Resend, Turnstile)
│
├── db/                     SQL you run once each in the Supabase SQL editor (see §10)
│   ├── schema.sql (subscribers)  comments.sql  highlights.sql  notes.sql
│   └── entitlements.sql  post_paywall.sql
│
├── tests/                  Vitest suite (global-setup builds; *.test.ts assert on dist/)
│
└── reference_files/        GIT-IGNORED personal material (the CV). Never commit.
```

---

## 5. Local development

Prereqs: **Node ≥ 22.12**, npm, git. Windows-friendly (built on Windows).

```bash
npm install
npx playwright install chromium   # once — needed for build-time Mermaid rendering
npm run dev        # dev server at http://localhost:4321
npm run build      # astro build + pagefind index → dist/
npm run preview    # serve the production build
npm test           # builds, then runs Vitest assertions on dist/
npm run deploy     # build + wrangler pages deploy dist  (see §13)
```

> Auth/DB/email/payments features only fully work when deployed (Functions run on
> Cloudflare) and when the env vars/secrets in §6 are set. `npm run dev` renders the UI;
> `/api/*` and `/gated/*` behave fully only in production (or `wrangler pages dev`).

---

## 6. Environment variables & secrets

Two kinds. **Public** values are embedded in the client bundle at build time. **Secrets**
are only available to the Functions at runtime and are never in the repo.

### Public (build-time) — `.env` at repo root (GIT-IGNORED)

| Var | What |
| --- | --- |
| `PUBLIC_SUPABASE_URL` | Supabase project URL, e.g. `https://xxxx.supabase.co` |
| `PUBLIC_SUPABASE_ANON_KEY` | Supabase **anon** key (public by design; RLS protects data) |
| `PUBLIC_TURNSTILE_SITE_KEY` | Cloudflare Turnstile **site** key (public) |

Because `.env` is git-ignored, a fresh clone needs these re-created before `npm run deploy`
(we deploy locally, so the values must exist on the build machine).

### Secrets (runtime) — Cloudflare Pages, set with `npx wrangler pages secret put NAME`

| Secret | Used by | What |
| --- | --- | --- |
| `SUPABASE_URL` | all Functions | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | all Functions | Supabase **service-role** key (bypasses RLS — server only, NEVER client) |
| `RESEND_API_KEY` | subscribe | Resend API key (also used as Supabase SMTP password) |
| `TURNSTILE_SECRET_KEY` | subscribe | Turnstile secret (server-side verification) |
| `DODO_API_KEY` | checkout | Dodo Payments API key (test or live) |
| `DODO_WEBHOOK_SECRET` | dodo-webhook | Dodo webhook signing secret (Standard Webhooks) |
| `DODO_API_BASE` *(optional)* | checkout | Defaults to `https://test.dodopayments.com`; set to `https://dodopayments.com` for live |

Supabase also needs **custom SMTP** configured (Authentication → SMTP) using Resend
(`smtp.resend.com:465`, user `resend`, password = a Resend API key) so auth emails send
reliably from `hello@areyoustillreading.dev`.

---

## 7. Writing & publishing a post

Add a Markdown file to `src/content/blog/` — the **filename is the URL slug**
(`my-post.md` → `/blog/my-post`). Frontmatter schema (`src/content.config.ts`):

```markdown
---
title: "My post"
description: "One line for listings, RSS, and SEO."
pubDate: 2026-07-25
updatedDate: 2026-08-01   # optional
tags: ["llm"]             # optional
draft: false              # true = hidden from listing/RSS/search/build
gateable: false           # true = monetizable (see §9 paywall); body kept out of static HTML
preview: "Public teaser."  # optional; shown before unlock on gateable posts
---

Body in Markdown. Fenced code is Shiki-highlighted, `$math$` renders via KaTeX,
and ```mermaid``` fences render to inline SVG at build time.
```

Then `npm run deploy`. Publishing = committing the file + deploying. (A web-based admin
editor is planned — see §16.)

---

## 8. Feature deep-dives (front end)

- **Markdown** — highlighting/math/diagrams configured in `astro.config.mjs`. Mermaid is
  rendered at build via Playwright, so **no diagram JS ships to the browser**.
- **Search** — `pagefind --site dist` runs after `astro build` (see `build` script) and
  indexes the public HTML. The `/gated/*` fragments carry `data-pagefind-ignore` so paid
  bodies never enter the search index.
- **RSS/sitemap/OG** — `/rss.xml` (descriptions only, never gated bodies), sitemap
  (excludes `/gated/`), and per-post OG images generated at `/og/<id>.png`.
- **Auth** — `/login` offers email magic-link + "Sign in with GitHub"; `/account` shows
  session + sign-out. Supabase Site URL + redirect allowlist must include the domain.
- **Comments / Highlights / Notes** — client components on each post; see §9 for the data
  model and privacy model. Admin (you) can see all readers' highlights/notes and join
  highlight discussions.

---

## 9. Cloudflare Functions reference

All Functions live in `functions/` and share `lib/email.js` helpers where relevant.

| Route | Method | Purpose | Key env |
| --- | --- | --- | --- |
| `/api/subscribe` | POST | Start double-opt-in: Turnstile verify → honeypot → insert pending → Resend confirm email. Generic responses (no email enumeration); 5-min resend cooldown. | SUPABASE_*, RESEND_API_KEY, TURNSTILE_SECRET_KEY |
| `/api/confirm?token=` | GET | Confirm a subscription (idempotent). | SUPABASE_* |
| `/api/unsubscribe?token=` | GET | One-click unsubscribe. | SUPABASE_* |
| `/api/checkout` | POST | Verify user token → look up the post's Dodo `product_id` → create a Dodo hosted checkout with `metadata {post_id,user_id}` → return `{url}`. | SUPABASE_*, DODO_API_KEY, DODO_API_BASE? |
| `/api/dodo-webhook` | POST | Verify Standard-Webhooks signature (HMAC-SHA256 over `id.timestamp.payload`) → on `payment.succeeded`, upsert an `entitlements` row (idempotent). | DODO_WEBHOOK_SECRET, SUPABASE_* |
| `/gated/*` | (middleware) | Gate the full-content fragments: if the post isn't paywalled → serve; else require a valid Supabase token AND (admin OR entitlement), else **403**. Fails safe (locked) on any error. | SUPABASE_* |

### Paywall architecture (the important one)

- A post is **monetizable** only if authored with `gateable: true`. For such posts, the
  public `/blog/<slug>` page renders **only the preview** (`<PaywallGate>`); the **full
  body is never in the static HTML, RSS, sitemap, or search index** (verified by
  `tests/paywall.test.ts`).
- The full body is emitted as a **bare fragment** at `/gated/<slug>` and is gated by
  `functions/gated/_middleware.js`. The browser fetches it with the reader's Supabase JWT
  in the `Authorization` header; the middleware verifies the token + entitlement.
- The admin toggle (`PaywallGate.astro`, admin-only) writes `post_paywall` (`is_paid`,
  `price_cents`, `product_id`). **Consequence:** a post that was ever fully public can't
  be retroactively locked, which is why monetizable posts are preview-only from day one.
- Purchase flow: **Unlock** → `/api/checkout` → Dodo hosted checkout → pay → Dodo
  **webhook** → `/api/dodo-webhook` writes the entitlement → the gate now serves the body.

---

## 10. Data model (Supabase) & setup order

RLS is enabled on **every** table. Run each file once in the Supabase **SQL editor**, in
this order (later files reuse `is_admin()` from `highlights.sql`):

1. `db/schema.sql` — **subscribers** (email list). RLS on, **no policies** → only the
   service-role Functions touch it. Columns: email, status(pending/confirmed/unsubscribed),
   confirm_token, unsubscribe_token, last_email_at, timestamps.
2. `db/comments.sql` — **comments** (public). RLS: select `true`; insert/delete `auth.uid()=user_id`.
3. `db/highlights.sql` — **admins** (add yourself: `insert into public.admins values ('<your-uuid>')`),
   `is_admin()` (plpgsql, security-definer), **highlights** (RLS: own-or-admin),
   **highlight_comments** (RLS: visible to the highlight's owner + admin).
4. `db/notes.sql` — **notes** (one per post per reader; RLS own-or-admin).
5. `db/entitlements.sql` — **entitlements** `(user_id, post_id)`. RLS: **select own only**;
   no write policy (only the webhook writes, via service role).
6. `db/post_paywall.sql` — **post_paywall** `(post_id, is_paid, price_cents, currency,
   product_id)`. RLS: select `true` (readers see if a post is paid); insert/update/delete
   `is_admin()`.

> `is_admin()` is deliberately **`language plpgsql`** — a `language sql` version failed to
> create in the Supabase editor because its body is validated before the `admins` table is
> visible in the same transaction (rolling everything back). plpgsql defers that check.

---

## 11. Testing

`npm test` runs Vitest. `tests/global-setup.ts` runs `npm run build` once (a green build
is itself the first gate), then each `tests/*.test.ts` asserts on the emitted `dist/`
files — e.g. pages exist, markup markers are present, feeds/sitemap are correct, and
crucially **paid bodies never leak** into public output. Nothing advances in development
until `npm test` is green.

---

## 12. Deployment

**Wrangler direct upload** (build locally, upload `dist/`):

```bash
npm run deploy   # = npm run build && wrangler pages deploy dist --project-name=areyoustillreading
```

- Chosen over Git-integration because **build-time Mermaid needs Chromium**; building
  locally avoids installing Playwright in CI. (If you switch to Git-integration later, set
  the build command to `npx playwright install chromium && npm run build`.)
- Custom domain `areyoustillreading.dev` is attached in the Cloudflare Pages dashboard
  (DNS + HTTPS automatic since the domain is in the same Cloudflare account).
- Secrets set via `wrangler pages secret put` apply immediately (no redeploy).

### Going live on payments (from test mode)

1. Create **live** product(s) in Dodo; put each product's id on its post via the admin
   toggle.
2. `npx wrangler pages secret put DODO_API_KEY` (live key) and `DODO_API_BASE` =
   `https://dodopayments.com`.
3. Create a **live** Dodo webhook → `https://areyoustillreading.dev/api/dodo-webhook`
   (event `payment.succeeded`) → `npx wrangler pages secret put DODO_WEBHOOK_SECRET`.
4. Remove the demo post `src/content/blog/premium-example.md`.

---

## 13. Security notes

- **RLS on every table.** The browser only ever holds the anon key + the user's JWT;
  policies restrict each reader to their own rows. The service-role key exists only inside
  Functions.
- **Paywall is server-side.** Gated bodies are never in static output; the `/gated`
  middleware fails safe (locked) on any error.
- **Webhook** signatures are HMAC-verified before writing entitlements. **Subscribe** has a
  honeypot, per-email cooldown, no-enumeration responses, and Turnstile.
- **Secrets** never enter the repo; `public/resume.pdf` and `reference_files/` are
  git-ignored. Security headers ship via `public/_headers`.
- **Git attribution** for this repo is `shivam7569 <shivam.iitmandi@gmail.com>`; Claude
  co-authorship is disabled and must stay off.

---

## 14. Gotchas learned (so you don't rediscover them)

- Astro 7's default Markdown processor ("Sätteri") ignores remark/rehype plugins → install
  **`@astrojs/markdown-remark`**.
- Files/folders prefixed with `_` under `src/pages/` are **not routed** by Astro — that's
  why the gated route is `src/pages/gated/…` (not `_gated`), with the Function middleware at
  `functions/gated/_middleware.js`.
- Resend refuses to send until the **domain is verified** ("added" ≠ "verified").
- `is_admin()` must be **plpgsql** (see §10).
- Dodo requires a **pre-created product** (no ad-hoc amounts) → each paid post stores a
  `product_id`. Remember to run the `alter table … add column product_id` migration.
- Complex shell one-liners (`$(...)` capture, `;`-chains) trigger permission prompts even
  when the binaries are allow-listed → prefer plain single commands.

---

## 15. Roadmap

- **Phase 1 — Free site + owned subscribe.** ✅ Done & live.
- **Phase 2 — Auth + engagement (comments, highlights + discussion, private notes).** ✅
- **Phase 3 — Per-post paywall (Dodo MoR).** ✅ (test mode; flip to live per §12).
- **Phase 4 — Admin: world-class post editor (drafts, code/diagrams/media/math) + admin
  dashboard.** Planned.
- **Phase 5 — UI/UX design refinement.** Planned.
