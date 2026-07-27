-- =============================================================================
-- db/analytics.sql — first-party, cookieless page analytics.
-- =============================================================================
-- WHAT THIS IS
--   One table, `public.analytics_events`, that stores anonymous page traffic for
--   the Studio's Analytics page. It is FIRST-PARTY (no third-party script) and
--   PRIVACY-SAFE: no cookies, no IP address, no user id, no personal data. A
--   "session" is a random per-browser-tab id (sessionStorage; gone when the tab
--   closes) used only to count visits — it cannot identify or follow a person.
--
-- HOW TO APPLY
--   Run ONCE by hand in the Supabase SQL editor (Dashboard → SQL Editor → New
--   query). There is no migration runner — this .sql file is the source of truth.
--   Analytics does not record anything until this table exists.
--
-- WHO TOUCHES IT
--   * functions/api/track.js               — inserts one row per beacon (service role).
--   * functions/api/admin/analytics.js     — reads/aggregates for the dashboard (service role, admin-gated).
--   The browser's anon key can do NEITHER — RLS is enabled with no policies (deny-all),
--   exactly like public.subscribers. Only the service-role key (server-side) can read/write.
-- =============================================================================

create table if not exists public.analytics_events (
  -- Monotonic surrogate key (high write volume; a uuid isn't needed here).
  id        bigint generated always as identity primary key,
  -- Server clock at ingest. Drives every time-range query + the daily chart.
  ts        timestamptz not null default now(),
  -- 'view' (one per page load) or 'read' (one per visit end, carrying scroll depth).
  type      text not null check (type in ('view', 'read')),
  -- The visited path (e.g. "/blog/hello-world"). Never a full URL, never query strings.
  path      text not null,
  -- Blog post slug when the path is /blog/<slug>; null for non-post pages. Lets the
  -- dashboard rank posts without parsing paths at read time.
  slug      text,
  -- EXTERNAL referrer HOSTNAME only (e.g. "news.ycombinator.com") — never the full
  -- referring URL, and never our own host. No PII.
  ref_host  text,
  -- Per-tab random id from sessionStorage. NOT a cookie, NOT persistent, NOT tied to
  -- identity — it only lets us count "visits" vs raw pageviews within a single tab.
  session   text,
  -- Coarse country from Cloudflare's cf-ipcountry header (e.g. "US"). No IP is stored.
  country   text,
  -- 'read' events only: max scroll depth reached, 0-100. Null for 'view' events.
  read_pct  int,
  -- 'read' events only: time on page in milliseconds. Null for 'view' events.
  dwell_ms  int
);

-- Deny-all RLS: the anon/public key can read or write NOTHING here. Only the
-- service-role key (Cloudflare Functions) bypasses RLS. Never add a permissive
-- policy — traffic data should never be exposed to the browser.
alter table public.analytics_events enable row level security;

-- Hot-path indexes: every dashboard query filters by ts; post ranking groups by
-- slug; a couple of counts filter by type.
create index if not exists analytics_events_ts_idx   on public.analytics_events (ts);
create index if not exists analytics_events_slug_idx on public.analytics_events (slug);
create index if not exists analytics_events_type_idx on public.analytics_events (type);
