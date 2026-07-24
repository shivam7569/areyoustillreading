# Personal Site — Consolidated Plan

Living planning document. Supersedes the original brief where they differ. No code
until explicitly asked. Updated as decisions are made.

---

## Purpose (priority order)
1. **Portfolio** — projects + resume. Urgent; drives a job search.
2. **Technical blog** — in-depth LLM-engineering posts, published regularly.
3. **Owned audience** — a subscriber email list, built from day one.

## Working rules
- No code files unless explicitly asked.
- Ask, don't assume. No silent defaults.
- Be factually/logically honest; correct rather than accommodate.
- Teach the mechanism, not just the result (owner is learning front-end from zero).

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

## Stack (candidates, not final)
- **Generator:** Astro — ships static by default, supports per-route hybrid/server
  rendering later without a rewrite. Preserves the paywall path for free.
- **Host:** Cloudflare Pages (free, serverless functions available).
- **Data:** free-tier DB (Cloudflare D1 / Supabase / Neon).
- **Email sending:** a service as a dumb pipe (Resend / Amazon SES) — we own the list
  in our DB; they handle deliverability. *Provider not yet chosen.*
- **Payments (phase 3):** Stripe one-time checkout.
- **Math/diagrams:** KaTeX + Mermaid, rendered at build time (plain HTML, no client JS).

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
- **Per-post, one-time, unlock-for-life.** Entitlement model: store `(reader, post,
  purchased)` rows. Stripe one-time checkout. Reuses phase-2 auth.
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

## Design direction
Pleasant, content-first, lightly animated. Craft goes into typography, spacing,
hierarchy, readability — not animation. Motion only where it clarifies. Start from a
minimal starter, reshape incrementally while learning CSS; explain every rule.

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
1. **Email sending service** — Resend vs SES vs other (check live free-tier limits).
2. **Price per post** — deferred to phase 3.
