-- ============================================================================
-- FILE: db/post_paywall.sql
-- ----------------------------------------------------------------------------
-- WHAT THIS IS
--   Idempotent Supabase/Postgres migration that defines the `post_paywall`
--   table plus its Row-Level Security (RLS) policies. This table is the single
--   source of truth for the LIVE, admin-controlled per-post paywall state — the
--   backing store behind the "Add to paywall / Remove from paywall" toggle the
--   site owner sees on each post.
--
-- SINGLE RESPONSIBILITY
--   Persist, per post, three facts: (1) is this post currently paywalled,
--   (2) at what price/currency, and (3) which Dodo Payments product represents
--   it. Nothing else. The gating LOGIC (token checks, entitlement lookups,
--   PaywallGate rendering) lives elsewhere in Pages Functions / Astro; this file
--   only owns the WHERE-the-flag-is-stored and WHO-may-flip-it concerns.
--
-- WHERE IT FITS IN THE ARCHITECTURE
--   - Static Astro site on Cloudflare Pages. Backend state lives in Supabase
--     Postgres, reached over PostgREST and hardened with RLS.
--   - The public site reads this table (via the browser Supabase JS client,
--     anon key) to decide whether to show unlock UI on a post.
--   - Pages Functions (the paywall/entitlement middleware from Phase 3) read
--     this table to know the current price/product when minting checkout
--     sessions or validating access.
--   - The admin toggle UI writes to this table; writes are gated by is_admin().
--
-- DEPENDENCIES (what this file needs to already exist)
--   - public.is_admin()  — SQL helper defined in db/highlights.sql. It returns
--     true only for the authenticated owner (looked up against the `admins`
--     table). ALL write protection here delegates to it. If that function is
--     missing, every policy below fails to create and the migration errors.
--   - The `admins` table (transitively, via is_admin()).
--
-- WHAT DEPENDS ON THIS FILE
--   - The admin "live paywall toggle" UI (insert/update/delete here).
--   - The content-gating middleware + PaywallGate component (read here).
--   - Dodo Payments checkout flow, which uses product_id / price_cents.
--
-- SECURITY MODEL / RLS RELIANCE (read before touching anything)
--   - RLS is the ONLY thing stopping an arbitrary visitor from marking posts
--     free or rewriting prices. The anon Supabase key is shipped to every
--     browser, so the anon role can reach this table over PostgREST. Do NOT
--     assume the client is trusted — the SELECT policy is deliberately open,
--     and the write policies deliberately require is_admin(). Removing or
--     loosening a write policy is a direct privilege-escalation / revenue bug.
--   - Read is intentionally public: is_paid/price are not secrets (they drive
--     public unlock UI). The actual PROTECTED CONTENT is never in this table;
--     it is gated server-side. So a public read here leaks nothing sensitive.
--   - price_cents lives in the DB, but a client must never be trusted to send
--     the price at checkout — the Pages Function should re-read price_cents
--     here server-side. This table is the authority; the browser is not.
--
-- IDEMPOTENCY / OPERATIONAL NOTES
--   - "Run once" but safe to re-run: every statement is create-if-not-exists or
--     drop-then-create, so applying the migration repeatedly is a no-op and
--     never drops data. The explicit ADD COLUMN IF NOT EXISTS handles upgrading
--     an older deployment whose table predates the product_id column.
--   - GOTCHA: `create table if not exists` will NOT retro-add columns to an
--     existing table — that's exactly why the standalone ADD COLUMN on line
--     below is required for forward-compatibility, not redundant.
-- ============================================================================

-- Admin-controlled per-post paywall status (the live "Add / Remove from paywall"
-- toggle). Requires public.is_admin() from db/highlights.sql. Run once.

-- Table shape:
--   post_id     — matches the Astro content slug/id; the natural PK, one row
--                 per gated post. text (not uuid) because posts are file-based.
--   is_paid     — the live toggle. Defaults to TRUE so that a freshly-inserted
--                 row is paywalled by default (fail-closed: adding a post to
--                 this table locks it unless explicitly opened).
--   price_cents — integer minor units (cents) to avoid float rounding on money.
--                 Default 500 = $5.00. Server re-reads this at checkout; never
--                 trust a client-supplied price.
--   currency    — ISO currency code, lowercase 'usd' to match Dodo Payments.
--   product_id  — the Dodo Payments (Merchant-of-Record) product this post maps
--                 to. Nullable: a row can exist before its MoR product is wired.
--   updated_at  — audit timestamp; set by the app on each toggle (no trigger
--                 here, so it only reflects writes that set it explicitly).
create table if not exists public.post_paywall (
  post_id     text primary key,
  is_paid     boolean not null default true,
  price_cents integer not null default 500,
  currency    text not null default 'usd',
  product_id  text,
  updated_at  timestamptz not null default now()
);
-- Forward-compat migration: older deployments created the table before
-- product_id existed. `create table if not exists` above would silently skip
-- adding it to a pre-existing table, so add it here explicitly. No-op on fresh
-- installs (column already present) and on re-runs.
alter table public.post_paywall add column if not exists product_id text;

-- Turn on RLS. WITHOUT this line, PostgREST would expose the table wide open to
-- the anon key and every policy below would be dead weight. This is the switch
-- that makes the policies actually enforce. Security-critical — never remove.
alter table public.post_paywall enable row level security;

-- READ policy: intentionally open to everyone (using (true)). The public site
-- must be able to ask "is this post paywalled, and at what price?" to render the
-- unlock/checkout UI, and it does so with the anon key. Nothing here is secret
-- (the gated CONTENT is protected server-side, not by hiding these flags), so a
-- fully-public read is safe by design. drop-then-create keeps this idempotent.
drop policy if exists "paywall read all" on public.post_paywall;
create policy "paywall read all" on public.post_paywall for select using (true);

-- WRITE policies: only the owner may flip the toggle or change pricing. Every
-- mutation path (insert/update/delete) delegates to public.is_admin(), which is
-- true solely for the authenticated site owner. These three policies are the
-- ONLY defense against a visitor marking posts free or rewriting prices via the
-- public anon key — treat them as revenue-critical. Dropped-then-recreated so
-- the migration is safely re-runnable.
drop policy if exists "paywall admin insert" on public.post_paywall;
drop policy if exists "paywall admin update" on public.post_paywall;
drop policy if exists "paywall admin delete" on public.post_paywall;
-- INSERT: with check() runs on the NEW row — only admins may add a post to the
-- paywall table (i.e. start gating it).
create policy "paywall admin insert" on public.post_paywall
  for insert with check (public.is_admin());
-- UPDATE: BOTH clauses required. using() decides which existing rows are even
-- visible/eligible to update; with check() re-validates the row after the edit.
-- A non-admin therefore can neither target a row nor sneak an admin-only value
-- past the check. (Editing price/is_paid/product_id all flow through here.)
create policy "paywall admin update" on public.post_paywall
  for update using (public.is_admin()) with check (public.is_admin());
-- DELETE: delete uses only using() (there is no NEW row to check). Only admins
-- may remove a post from the paywall (un-gate it entirely).
create policy "paywall admin delete" on public.post_paywall
  for delete using (public.is_admin());
