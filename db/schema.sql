-- =============================================================================
-- db/schema.sql — Newsletter subscriber schema (Supabase / Postgres)
-- =============================================================================
--
-- WHAT THIS FILE IS
--   The canonical DDL for the `public.subscribers` table: the owned email list
--   backing the site's newsletter. It defines the table, its double opt-in
--   status machine, the two capability tokens (confirm + unsubscribe), the RLS
--   lockdown, and the lookup indexes. It is idempotent (every statement uses
--   `if not exists` / `enable`) so re-running it is safe.
--
-- SINGLE RESPONSIBILITY
--   Persist newsletter subscribers and their opt-in lifecycle. Nothing else —
--   no posts, no payments, no auth. Those live in other tables/migrations
--   (e.g. admins, post_paywall, entitlements from the Phase 3 work).
--
-- HOW TO APPLY
--   Run ONCE, by hand, in the Supabase SQL editor
--   (Dashboard → SQL Editor → New query). There is no automated migration
--   runner in this project; this .sql file IS the source of truth. If you
--   change columns here, apply the delta manually in the same editor.
--
-- WHERE IT FITS IN THE ARCHITECTURE
--   This table is the newsletter slice of a larger stack: a static Astro build
--   on Cloudflare Pages, backed by Cloudflare Pages Functions, Supabase
--   (Postgres + this schema), and Dodo payments (the premium/entitlement side —
--   gated posts, sign-in-gated publishing — which lives in OTHER tables, not
--   here). For THIS table specifically:
--   Static Astro site on Cloudflare Pages. The public/anon Supabase key is NOT
--   used to touch this table (see RLS note below). Instead, a Cloudflare Pages
--   Function (server-side) holds the Supabase SERVICE-ROLE key and performs all
--   reads/writes here:
--     • Subscribe form  → Function inserts a row (status='pending'), sets
--       confirm_token, and sends a confirmation email via Resend (Turnstile
--       guards the form against bots first).
--     • Confirm link    → Function looks the row up by confirm_token, flips
--       status→'confirmed', stamps confirmed_at, and (typically) clears the
--       now-spent confirm_token.
--     • Unsubscribe link → Function looks the row up by unsubscribe_token and
--       flips status→'unsubscribed'.
--   Resend (as Supabase SMTP) delivers the transactional mail. `last_email_at`
--   lets the sender throttle / avoid double-sends.
--
-- DEPENDS ON
--   • pgcrypto's gen_random_uuid() — ships enabled on Supabase; used for the
--     row id and the unsubscribe token default.
--   • The Cloudflare Function code that owns the service-role key. That code is
--     the ONLY intended writer/reader and is what depends on this schema.
--
-- SECURITY MODEL — READ BEFORE CHANGING ANYTHING
--   RLS is enabled with ZERO policies (below). In Postgres/PostgREST that means
--   the anon and authenticated API keys can see NOTHING and write NOTHING — the
--   email list is never exposed to the browser. Only the service-role key,
--   which bypasses RLS entirely, can touch these rows. This is the whole
--   security story for this table, so:
--     • NEVER add a permissive RLS policy without deliberately deciding to
--       expose subscriber data (you almost certainly don't want to).
--     • NEVER ship the service-role key to the client. It lives only in the
--       Cloudflare Function's server-side env.
--   The two tokens (confirm_token, unsubscribe_token) are UUIDv4 capability
--   tokens: unguessable, single-purpose secrets emailed to the address owner.
--   Possession of the token IS the authorization — that's why they must stay
--   random (gen_random_uuid) and be looked up by exact match (indexes below).
-- =============================================================================

-- Owned email list — subscribers table with double opt-in.
-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New query).

create table if not exists public.subscribers (
  -- Surrogate primary key. Random UUID (not a serial) so ids are non-sequential
  -- and non-enumerable — you can't guess neighbouring rows by incrementing.
  id                uuid primary key default gen_random_uuid(),

  -- The subscriber's address. UNIQUE enforces one row per email at the DB level,
  -- so a re-subscribe attempt collides instead of creating duplicates (the
  -- Function is expected to handle that conflict, e.g. upsert / re-send confirm).
  -- NOT NULL: a subscriber with no address is meaningless.
  email             text unique not null,

  -- Double opt-in state machine. Rows start 'pending' (email captured but not
  -- yet verified); the confirm link moves them to 'confirmed' (the only state
  -- that should ever receive newsletters); the unsubscribe link moves them to
  -- 'unsubscribed'. The CHECK constraint is a fail-safe: it makes any typo or
  -- rogue value a hard DB error rather than a silently-broken state that could
  -- e.g. mail an unconfirmed address.
  status            text not null default 'pending'
                      check (status in ('pending', 'confirmed', 'unsubscribed')),

  -- One-time capability token emailed in the "confirm your subscription" link.
  -- Nullable on purpose: it's only meaningful while status='pending', and the
  -- confirm Function typically nulls it out once spent so the link can't be
  -- replayed. No default — the Function sets it explicitly at insert time.
  confirm_token     uuid,

  -- Timestamp of the last email sent to this row. Used by the sender to throttle
  -- and to avoid double-sending (e.g. two rapid confirm clicks / retries).
  last_email_at     timestamptz,

  -- Long-lived capability token embedded in every newsletter's unsubscribe link
  -- (one-click, no login). Generated at insert time by default so a valid
  -- unsubscribe path always exists. Kept for the row's lifetime (unlike
  -- confirm_token) because the user may unsubscribe at any point in the future.
  unsubscribe_token uuid not null default gen_random_uuid(),

  -- When the row was created (subscribe attempt time). Server clock via now().
  created_at        timestamptz not null default now(),

  -- When the address was verified. NULL until the confirm link is clicked; a
  -- non-null value is effectively the audit trail that double opt-in happened.
  confirmed_at      timestamptz
);

-- Lock the table down: enable RLS with NO policies. The anon/public API key then
-- has zero access; only the service-role key (used by the Cloudflare Function,
-- which bypasses RLS) can read/write. Never expose the service-role key client-side.
--
-- WHY "enable" with no accompanying "create policy": in Postgres, RLS-enabled +
-- zero-policies = deny-all for every non-superuser/non-bypass role. This is the
-- deliberate posture — the browser (anon key) must never read the email list.
-- The service-role key has BYPASSRLS, so the Cloudflare Function is unaffected.
-- Adding ANY policy here would start leaking rows to the anon role; don't.
alter table public.subscribers enable row level security;

-- Token lookup indexes. The confirm and unsubscribe flows both find a row by an
-- exact token match (WHERE confirm_token = $1 / WHERE unsubscribe_token = $1).
-- These indexes keep those lookups O(log n) instead of full scans as the list
-- grows; they're on the hot path of every confirm/unsubscribe click.
create index if not exists subscribers_confirm_token_idx on public.subscribers (confirm_token);
create index if not exists subscribers_unsub_token_idx  on public.subscribers (unsubscribe_token);
