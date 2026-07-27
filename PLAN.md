# Personal Site — Consolidated Plan

Living planning document. Supersedes the original brief where they differ. Updated as
decisions are made.

**Status (2026-07-27):** Phases 1–4 substantially built and live on the **`dev`**
Cloudflare preview — **not yet promoted to production (`main`)**. Shipped since 2026-07-24:
- **Phase 1** — done and deployed: blog pipeline, Shiki, KaTeX, SEO/OG, RSS, sitemap,
  Pagefind search, resume + projects, owned email capture (double opt-in), custom domain.
- **Phase 2 (auth + engagement)** — done: Supabase auth (magic-link + GitHub), comments,
  highlights + reader↔admin discussion, private reader notes; Resend as the email pipe.
- **Phase 3 (payments / paywall)** — working in Dodo **test mode**: per-post paywall with
  **price-only checkout** — reader pays an admin-set price via **Dodo Payments** (Merchant
  of Record) using ONE reusable "Pay What You Want" product; signature-verified webhook
  grants a permanent entitlement. Verified end-to-end on `dev`.
- **Phase 4 (authoring + admin)** — done on `dev`: premium in-browser **Milkdown editor**
  (drafts, language-aware code blocks, live **D2** diagrams [replaced Mermaid — no
  Chromium], interactive Plotly python cells); **instant-publish** (render-at-publish → KV
  overlay → seconds-to-live); full **admin dashboard** at `/admin` (Home · Posts · Write ·
  Audience · Engagement · Revenue · Settings) gated by a client admin-gate + server-side
  `requireAdmin`; visual per-post **paywall toggle** on Posts; a "Studio" link on the
  public site shown only to admins.

**Remaining for launch:** promote `dev` → `main` (production); swap Dodo **test → live**
keys + a live PWYW product; re-confirm the admin gate before launch; move editor drafts
from localStorage to per-user Supabase; add read-through analytics (Plausible); remove the
demo `premium-example.md`. (Phase 5 — UI/UX design polish — still to come.)

---

## Purpose (priority order)
1. **Portfolio** — projects + resume. Urgent; drives a job search.
2. **Technical blog** — in-depth LLM-engineering posts, published regularly.
3. **Owned audience** — a subscriber email list, built from day one.

## Working rules
- Build autonomously toward a working platform; don't pause for input unless truly
  blocked (external accounts/credentials/DNS).
- Every code increment gets a test; nothing advances until `npm test` is green. Commit
  per increment; push to GitHub. Git author is `shivam7569` — NEVER add Claude as
  co-author/collaborator.
- Keep responses short and informative — no codebase teaching unless asked.
- Ask, don't assume on genuine forks. Be factually/logically honest; correct rather than accommodate.

---

## Architecture reframe
The original brief scoped a *pure static* site (no DB, no backend, no login). The
chosen feature set — **owned subscriber list**, **per-post paywall**, **comments /
highlights / private notes** — requires server-side state. So this is a **full-stack
app with a static blog front-end**, built on a **server-capable foundation** used
lazily: static by default, server routes added phase by phase.

- **Cost:** free at launch (free tiers), small per-sale cost only when the paywall is
  live. No fixed cost beyond the domain until then.
- **Security:** offload auth to a hosted service; use Stripe hosted checkout (card data
  never touches our code); all gating server-side (client-side paywalls aren't paywalls).

## Stack (decided)
- **Generator:** Astro 7 — ships static by default, supports per-route hybrid/server
  rendering later without a rewrite. Preserves the paywall path for free.
- **Host:** Cloudflare Pages (free, serverless functions available).
- **Deploy:** Wrangler **direct upload** (Option B) — build locally (`npm run build`),
  upload `dist` with `wrangler pages deploy`. Avoids installing Chromium in CI for the
  build-time Mermaid step. Git auto-deploy can be layered on later.
- **Data:** **Supabase** (hosted Postgres) — also powers Auth (single vendor).
- **Auth (phase 2):** **Supabase Auth** — bundled with the DB choice above.
- **Email sending:** **Resend** as a dumb pipe — we own the list in our DB; they handle
  deliverability. (Verify current free-tier limits before launch.)
- **Payments (phase 3):** **Dodo Payments** (Merchant of Record) one-time **hosted
  checkout** (card data never touches our code) — Stripe is unavailable in India. Uses a
  reusable Pay-What-You-Want product so the admin-set price is charged per post with no
  per-post product to manage.
- **Math/diagrams:** KaTeX + **D2** (WASM), rendered at build time (plain HTML, no client
  JS). D2 replaced Mermaid to drop the Chromium build dependency.

---

## Phasing

### Phase 1 — Free site + owned subscribe (ship first, for the job search)
- Astro skeleton → Markdown post pipeline (frontmatter schema, post template, listing).
- Code highlighting, KaTeX math, Mermaid diagrams, verified with a real post.
- Deploy to Cloudflare Pages, connect domain, confirm HTTPS.
- Layout + CSS, incrementally, mechanism explained as built.
- Resume page + downloadable PDF; projects section.
- **Owned email capture:** DB + serverless function catches signups; double opt-in
  (confirmation click) + one-click unsubscribe (both legally required). Sending service
  wired as the pipe.
- **RSS feed** (build-time), sitemap, meta/OpenGraph tags, client-side search.
- *No login in phase 1.*

### Phase 2 — Auth + engagement features
- **Auth (hosted)** — the shared foundation for phase 3 too; build once.
- **Comments**, **highlights**, **private reader's notes** (visible to that reader +
  admin only). All per-reader data → all require login.

### Phase 3 — Payments (knob flips on)
- **Per-post, one-time, unlock-for-life.** Entitlement model: store `(reader, post)`
  rows, written only by a signature-verified payment webhook. Reuses phase-2 auth.
- **Payment provider — NOT Stripe.** Stripe general availability has not resumed in
  India (as of 2026), and the audience is *global*. Prefer a **Merchant of Record**
  (Paddle / Lemon Squeezy→Stripe Managed Payments / Dodo Payments): MoR is the seller of
  record, handles global VAT/sales-tax/GST, pays out to India; ~5% + $0.50/txn buys away
  all tax compliance. Alternative: **Razorpay International** (RBI PA-CB licensed, ~3%+GST,
  auto eFIRC) if India-first. Architecture is provider-agnostic (hosted checkout + webhook
  + entitlements). *Provider TBD — verify onboarding/eligibility first.*
- **Admin live paywall toggle.** Each post has an admin-only (`is_admin()`) **Add to
  paywall / Remove from paywall** control; status stored in Supabase, not frontmatter.
  Consequence: a monetizable post must be **preview-only in static HTML from day one**
  (once full content is public/indexed it can't be retroactively gated). Authoring marks
  posts `gateable: true` → content served via an entitlement-checking Function, never in
  static HTML; the live toggle flips whether a gateable post currently requires purchase.
  Non-gateable posts stay fully static (SEO). Already-public posts can't become paid.
- The free list built in phase 1 is the conversion funnel here (founding-member pricing).

### Launch task — social publishing pipeline (later phase, backend feature)
Owner writes the campaign copy; the system **stores finalized messages and publishes**
to platforms. Per-platform reality:
- **Reddit** — official API, scriptable. ✅
- **LinkedIn** — API works but needs approved OAuth app. ⚠️
- **Instagram** — Business/Creator only, image/video required, no plain text. ⚠️
- **WhatsApp** — no public post API; effectively manual. ❌
Needs DB + functions + stored API credentials; reuses existing backend.

---

## Subscriber list — uses (from subscriber #1)
1. New-post alerts.
2. Periodic digest (weekly/monthly), separate from per-post pings; let readers choose.
3. Subscriber-only early access (free "gating"; builds the paying habit).
4. Project / demo launch announcements.
5. Ask-the-audience ("what should I write next?") — content ideas + engagement.
6. **Strategic:** this list is the future paying audience for the phase-3 paywall.

## Website security (cross-cutting — every phase)
Security is a standing requirement, not a phase. Baseline:
- **HTTPS everywhere** (automatic via Cloudflare) + security headers (CSP, HSTS,
  X-Content-Type-Options, Referrer-Policy).
- **Secrets never in the repo or client** — API keys / DB creds live in Cloudflare env vars only.
- **All gating server-side** — never trust the client for paywall / auth / entitlements.
- **Validate + rate-limit every server endpoint** (subscribe, comments, checkout).
- **Email:** double opt-in (prevents list-bombing) + one-click unsubscribe.
- **Stripe:** verify webhook signatures; entitlements written only from verified events.
- **Auth:** offload to Supabase (hosted) — no hand-rolled password/session code.
- **Dependencies:** keep updated; `npm audit` clean (currently 0 vulnerabilities).

## Design direction (chassis — *after* the engine)
**Order of work: build the engine first, then the chassis.** Ship the functional
platform (deploy → email → auth → payments) before investing in deep visual design. The
current look is a deliberately minimal, functional baseline.

Theming pass (later): pleasant, content-first, lightly animated. Craft into typography,
spacing, hierarchy, readability — not animation. Motion only where it clarifies. Reshape
the minimal baseline incrementally.

## RSS (decided: include)
Build-time XML file listing posts. Readers follow via a reader app (pull model, no
signup, anonymous). Free, zero maintenance, favored by dev audiences. Complements email:
RSS = frictionless/anonymous; email = owned relationship. Widens the funnel at ~no cost.

---

## Environment (resolved)
- **Node** v24.16.0 (current LTS), **npm** 11.13.0, **git** 2.54.0 — all current.
- **Project path:** `C:\Users\Andy\Documents\areyoustillreading`
- **Domain:** `areyoustillreading.dev` — **Cloudflare Registrar** (registrar + DNS + host
  all Cloudflare; simplest deploy/HTTPS path).

## Open questions
1. ~~Email sending service~~ → **Resend** (verify live free-tier limits before launch).
2. **Price per post** — deferred to phase 3.
