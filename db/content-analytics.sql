-- =============================================================================
-- db/content-analytics.sql — the reading-shape retention RPC for the feed.
-- Public-schema SECURITY DEFINER over public.analytics_events (deny-all to clients).
-- Returns, per post slug, the "readers remaining" shape at each decile (10..100%):
-- a shape, never a score — how many readers were still there start to finish, with
-- the notch where a piece loses most of them. Aggregate only (no counts, no PII).
-- Idempotent. Depends on db/analytics.sql.
-- =============================================================================

-- Hot path for the retention query: read events by slug + how-far-they-got.
create index if not exists analytics_read_slug_pct_idx
  on public.analytics_events (slug, read_pct) where type = 'read';

create or replace function public.feed_retention(p_slugs text[])
returns table (slug text, samples int[])
language sql stable security definer set search_path = public, extensions as $$
  select sl.slug,
    -- Need a handful of readers before a shape means anything; otherwise null → no curve.
    case when tot.n >= 5 then (
      select array_agg(
        round(100.0 * (
          select count(*) from public.analytics_events e
          where e.type = 'read' and e.slug = sl.slug and e.read_pct >= g.x
        ) / tot.n)::int
        order by g.x)
      from generate_series(10, 100, 10) g(x)
    ) else null end
  from unnest(p_slugs) sl(slug)
  cross join lateral (
    select count(*)::numeric n from public.analytics_events e2
    where e2.type = 'read' and e2.slug = sl.slug
  ) tot;
$$;

grant execute on function public.feed_retention(text[]) to anon, authenticated;

-- VERIFY (optional): select slug, samples from public.feed_retention(array['feature-test']);
