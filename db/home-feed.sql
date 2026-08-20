-- =============================================================================
-- db/home-feed.sql — homepage-specific read RPCs (public, SECURITY DEFINER).
--   public.home_popular_posts  — EVERY published post, ordered by most-read first.
--       The homepage feed is time-boxed to the last fortnight; during a ghost period
--       (nothing published in 14 days) that feed would be empty, so the page tops up
--       from the whole archive sorted by popularity. Read counts come from
--       analytics_events (RLS deny-all → only a definer function may read them), so a
--       post with no reads yet still appears, just after the well-read ones (date tiebreak).
--   public.home_series_in_progress — the "coming next" shelf: series still running and
--       the part each is waiting on. Best-effort from the series metadata we have today
--       (total / planned / status); the homepage hides the shelf when it returns nothing.
-- Same row vocabulary as list_feed_posts so the client renders identical feed rows.
-- Idempotent. Depends on db/content.sql + db/content-collab.sql + db/analytics.sql.
-- Apply:  node --env-file=.env scripts/apply-sql.mjs db/home-feed.sql
-- =============================================================================

-- ── most-read posts across all authors (the ghost-period / quiet-fortnight top-up) ──
drop function if exists public.home_popular_posts(int);
create or replace function public.home_popular_posts(p_limit int default 24)
returns table (
  post_id       uuid,
  slug          text,
  title         text,
  description   text,
  tags          text[],
  pub_date      timestamptz,
  reading_min   int,
  primary_handle citext,
  primary_name  text,
  author_count  int,
  author_names  text[],
  series_slug   text,
  series_title  text,
  series_part   int,
  series_total  int,
  field_slug    text,
  field_title   text,
  reads         int
)
language sql stable security definer set search_path = public, content, extensions as $$
  select
    po.id, po.slug, po.title, po.description, po.tags, po.pub_date, po.reading_min,
    pr.handle, pr.pen_name,
    (select count(*)::int from content.post_authors pa where pa.post_id = po.id and pa.accepted),
    (select array_agg(p2.pen_name order by pa.position)
       from content.post_authors pa join content.profiles p2 on p2.id = pa.user_id
       where pa.post_id = po.id and pa.accepted),
    ser.slug, ser.title, ser.part, ser.total, ser.field_slug, ser.field_title,
    coalesce(rc.reads, 0)
  from content.posts po
  join content.profiles pr on pr.id = po.author_id
  left join lateral (
    select se.slug, se.title, sp.position as part, se.total,
           fld.slug as field_slug, fld.title as field_title
    from content.series_posts sp
    join content.series se on se.id = sp.series_id and se.deleted_at is null
    left join lateral (
      select f.slug, f.title
      from content.field_series fs
      join content.fields f on f.id = fs.field_id and f.deleted_at is null
      where fs.series_id = se.id and fs.accepted
      order by f.created_at
      limit 1
    ) fld on true
    where sp.post_id = po.id and sp.accepted
    order by se.created_at
    limit 1
  ) ser on true
  -- popularity: completed reads for this slug (analytics_events is per-slug, not author-scoped;
  -- a shared slug slightly over-counts, which is acceptable for a fallback ranking).
  left join lateral (
    select count(*)::int as reads
    from public.analytics_events ae
    where ae.type = 'read' and ae.slug = po.slug
  ) rc on true
  where po.status = 'published' and po.visibility = 'public' and po.deleted_at is null
  order by coalesce(rc.reads, 0) desc, po.pub_date desc nulls last
  limit least(greatest(p_limit, 1), 60);
$$;

grant execute on function public.home_popular_posts(int) to anon, authenticated;

-- ── series still running + the part each is waiting on (the "coming next" shelf) ──
drop function if exists public.home_series_in_progress(int);
create or replace function public.home_series_in_progress(p_limit int default 6)
returns table (
  series_slug   text,
  series_title  text,
  owner_handle  citext,
  field_title   text,
  published     int,
  total         int,
  next_part     int,
  next_title    text,
  status        text
)
language sql stable security definer set search_path = public, content, extensions as $$
  with pub as (
    -- published, accepted parts per series
    select sp.series_id, count(*)::int as n
    from content.series_posts sp
    join content.posts po on po.id = sp.post_id
    where sp.accepted and po.status = 'published' and po.visibility = 'public' and po.deleted_at is null
    group by sp.series_id
  )
  select
    se.slug, se.title, pr.handle,
    fld.title as field_title,
    coalesce(pub.n, 0) as published,
    -- effective total: the author's declared total, else however many planned titles exist
    greatest(coalesce(se.total, 0), coalesce(array_length(se.planned, 1), 0), coalesce(pub.n, 0)) as total,
    coalesce(pub.n, 0) + 1 as next_part,
    nullif(btrim(coalesce(se.planned[coalesce(pub.n, 0) + 1], '')), '') as next_title,
    coalesce(se.status::text, 'in-progress') as status
  from content.series se
  join content.profiles pr on pr.id = se.owner_id
  left join pub on pub.series_id = se.id
  left join lateral (
    select f.title
    from content.field_series fs
    join content.fields f on f.id = fs.field_id and f.deleted_at is null
    where fs.series_id = se.id and fs.accepted
    order by f.created_at
    limit 1
  ) fld on true
  where se.deleted_at is null
    and coalesce(se.status::text, 'in-progress') <> 'complete'
    -- "in progress" = more parts intended than are out yet
    and greatest(coalesce(se.total, 0), coalesce(array_length(se.planned, 1), 0)) > coalesce(pub.n, 0)
  order by coalesce(pub.n, 0) desc, se.updated_at desc
  limit least(greatest(p_limit, 1), 12);
$$;

grant execute on function public.home_series_in_progress(int) to anon, authenticated;

notify pgrst, 'reload schema';

-- VERIFY (optional):
--   select slug, title, reads from public.home_popular_posts(5);
--   select series_title, published, total, next_part, next_title, status from public.home_series_in_progress(6);
