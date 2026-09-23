-- =============================================================================
-- db/reset-data.sql — WIPE all test/demo DATA for a clean launch. ONE-TIME.
-- -----------------------------------------------------------------------------
-- Empties every reader-generated + metrics table so the Studio dashboards
-- (Analytics, Engagement, Revenue, Audience) all start from zero — a fresh slate
-- to launch on.
--
-- THIS IS DATA ONLY. It does NOT touch: the schema, RLS policies, triggers,
-- functions, the `public.admins` table (your Studio access is preserved), the
-- site copy (site.json), the blog content, or the website in any way.
--
-- HOW TO RUN: paste into the Supabase SQL editor and run once, when you're ready.
-- IRREVERSIBLE — these rows are permanently deleted.
--
-- NOT included (left intact): public.admins. Auth reader accounts (auth.users)
-- are also left alone — if you want those gone too, remove them separately from
-- Supabase → Authentication → Users (keep your own admin account).
-- =============================================================================

truncate table
  public.analytics_events,    -- Analytics: pageviews / events (incl. lt_ load-test rows)
  public.feedback,            -- "Did it hold?" reader verdicts
  public.comments,            -- comments + threaded replies
  public.highlight_comments,  -- highlight discussions
  public.highlights,          -- reader highlights
  public.notes,               -- reader private notes
  public.votes,               -- upvotes
  public.entitlements,        -- paywall unlocks  → Revenue (clears the test ~$507 / 3 unlocks)
  public.drafts,              -- server-side editor drafts
  public.subscribers,         -- email list        (you chose: wipe for a fresh list)
  public.post_paywall         -- per-post paywall prices (you chose: clear)
restart identity;

-- Verify the wipe — every column below should read 0 except admins_kept:
select
  (select count(*) from public.analytics_events) as analytics,
  (select count(*) from public.comments)         as comments,
  (select count(*) from public.highlights)       as highlights,
  (select count(*) from public.highlight_comments) as hl_discussion,
  (select count(*) from public.notes)            as notes,
  (select count(*) from public.votes)            as votes,
  (select count(*) from public.feedback)         as feedback,
  (select count(*) from public.entitlements)     as entitlements,
  (select count(*) from public.subscribers)      as subscribers,
  (select count(*) from public.post_paywall)     as paywall,
  (select count(*) from public.drafts)           as drafts,
  (select count(*) from public.admins)           as admins_kept;
