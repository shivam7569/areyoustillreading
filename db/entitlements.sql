-- ============================================================================
-- db/entitlements.sql
-- ----------------------------------------------------------------------------
-- WHAT THIS FILE IS
--   The Postgres schema for the paywall's "who-has-paid-for-what" ledger. It
--   defines exactly one thing: the `public.entitlements` table plus its
--   Row-Level Security (RLS) posture and supporting index. This is the durable
--   record of a completed one-time purchase — buy a post once, unlock it for
--   life (there is no expiry column; presence of a row == permanent access).
--
-- SINGLE RESPONSIBILITY
--   Persist the fact "user X owns post Y", nothing more. It does NOT price
--   posts, track payment status, store provider order IDs, or handle refunds.
--   Any of that lives elsewhere (payment provider dashboard, webhook code, or a
--   future table). Keep this table minimal so RLS reasoning stays trivial.
--
-- HOW IT FITS THE ARCHITECTURE
--   Static Astro site on Cloudflare Pages. Paid content is gated by the
--   PaywallGate component + Pages Functions middleware (see the Phase-3 commits:
--   /gated route, token/entitlement middleware, PaywallGate). The runtime access
--   check is: "does the signed-in Supabase user have an entitlements row for
--   this post_id?" The browser's Supabase JS client SELECTs from this table
--   under RLS to unlock content client-side; server middleware may also check it
--   with a privileged key. Admin bypass (owner previewing paywalled posts) is
--   handled separately via the `admins` table / `is_admin()` — NOT here.
--
--   NOTE ON PAYMENT PROVIDER: the project uses Dodo Payments (Merchant-of-Record)
--   per the current architecture; the "Stripe webhook" wording below is historical
--   from an earlier plan. The security model is identical regardless of provider:
--   the writer is a trusted, server-side webhook handler using the Supabase
--   service-role key. Treat "Stripe webhook" as "the payment webhook handler".
--
-- DEPENDS ON (upstream)
--   * auth.users        — Supabase Auth users table (FK target below).
--   * gen_random_uuid() — pgcrypto/pgcore built-in; ships with Supabase.
--   * The payment webhook handler (service-role key) — the ONLY writer.
--
-- DEPENDED ON BY (downstream)
--   * PaywallGate + the gated-content middleware (read path).
--   * The payment webhook (write path) — inserts a row on successful purchase.
--   * Any post_id referenced here is a content slug (see post_paywall admin
--     toggle table); post_id is a free-form text slug, NOT a DB foreign key,
--     because posts are static Markdown, not rows.
--
-- SECURITY MODEL / RLS RELIANCE  (read before touching anything)
--   * RLS is the security boundary. The anon/public browser key is UNTRUSTED;
--     it can only ever run what the policies below permit.
--   * SELECT is allowed but scoped to the caller's OWN rows (auth.uid() =
--     user_id). A user can therefore never see, enumerate, or infer another
--     user's purchases.
--   * There is DELIBERATELY no INSERT/UPDATE/DELETE policy. Under RLS, absence
--     of a policy = deny. So the browser can NEVER mint itself an entitlement.
--     Writes happen only via the service-role key, which bypasses RLS entirely.
--     This is the whole anti-fraud story: you cannot grant yourself access by
--     calling PostgREST directly, only a verified payment can.
--   * GOTCHA: if you ever add a permissive write policy "for convenience",
--     you break the paywall — anyone could self-grant. Don't. Writes stay
--     server-side + service-role only.
--   * GOTCHA: enabling RLS (below) with zero policies would deny SELECT too,
--     silently breaking client-side unlock. The read-own policy is required for
--     the browser unlock to work at all.
--
-- OPERATIONAL NOTES
--   * Idempotent: every statement uses IF NOT EXISTS / DROP-then-CREATE, so this
--     file is safe to re-run. Run once (or again) in the Supabase SQL editor.
--   * DO NOT change/rename columns casually: PaywallGate, the middleware, and the
--     webhook all key off `user_id`, `post_id`, and the (user_id, post_id) pair.
-- ============================================================================

-- Per-post purchase entitlements (one-time, unlock-for-life).
-- Rows are written ONLY by the payment webhook handler (Dodo Payments today;
-- "Stripe" in older comments) using the Supabase service-role key, which
-- bypasses RLS. Run once in the Supabase SQL editor.

create table if not exists public.entitlements (
  -- Surface key; not exposed in app logic, but handy for admin/debug references.
  id         uuid primary key default gen_random_uuid(),
  -- Buyer. FK into Supabase Auth. ON DELETE CASCADE means: if the user deletes
  -- their account, their entitlements evaporate too (no orphaned access rows,
  -- and no way to "inherit" a deleted user's purchases).
  user_id    uuid not null references auth.users(id) on delete cascade,
  -- The purchased content's slug. Free-form text on purpose: posts are static
  -- Markdown files, not DB rows, so there is nothing to foreign-key against.
  -- Must match the slug PaywallGate/middleware use to look purchases up.
  post_id    text not null,
  -- When the purchase landed. Also the de-facto "owned since" timestamp.
  created_at timestamptz not null default now(),
  -- INTENT: one entitlement per (user, post). This is the idempotency guard for
  -- the webhook — a duplicate/retried payment event that re-inserts the same
  -- pair hits this constraint instead of creating a second access row. It also
  -- backs the ON CONFLICT logic a well-behaved webhook uses on upsert.
  unique (user_id, post_id)
);

-- Turn on the RLS gate. From here, the untrusted browser key can do ONLY what an
-- explicit policy allows. Without the SELECT policy below, this line alone would
-- also block reads and break client-side unlock — see header GOTCHA.
alter table public.entitlements enable row level security;

-- Readers may check their OWN entitlements (to unlock content client-side).
-- There is deliberately NO insert/update/delete policy: only the webhook,
-- using the service-role key, ever writes here.
--
-- WHY DROP-then-CREATE: CREATE POLICY has no IF NOT EXISTS, so to keep this file
-- idempotently re-runnable we drop any prior version first. Safe because the
-- policy is recreated identically on the next line.
--
-- SECURITY: `auth.uid() = user_id` is the entire read-scope check. auth.uid()
-- resolves to the JWT's subject for the current request, so a caller can only
-- ever match — and therefore SELECT — rows they own. No cross-user leakage, no
-- enumeration of who bought what.
drop policy if exists "entitlements read own" on public.entitlements;
create policy "entitlements read own" on public.entitlements
  for select using (auth.uid() = user_id);

-- Composite index on the exact (user_id, post_id) shape every access check uses
-- ("does THIS user own THIS post?"). Makes the paywall lookup an index probe
-- instead of a scan; also mirrors the UNIQUE constraint's column order.
create index if not exists entitlements_user_post_idx on public.entitlements (user_id, post_id);
