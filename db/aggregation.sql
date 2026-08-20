-- =============================================================================
-- db/aggregation.sql — DB-driven series/fields reads (public, SECURITY DEFINER).
--   public.my_series()          — the signed-in author's own series (Studio manager).
--   public.my_fields()          — the signed-in author's own fields  (Studio manager).
--   public.list_public_series() — EVERY public series across all authors, with the involved
--       authors, for the /series aggregation page. "Public" = has ≥1 published public post.
--       Reflects collaboration: involved_handles/names carry every author who has a published
--       part, so the design can show a series under each of them (decision: shared work shows
--       on every involved author's page).
-- Idempotent. Apply: node --env-file=.env scripts/apply-sql.mjs db/aggregation.sql
-- =============================================================================

-- ── the author's own series (Studio) ─────────────────────────────────────────
create or replace function public.my_series()
returns table (id uuid, slug text, title text, summary text, total int, status text, published int, planned text[])
language sql stable security definer set search_path = public, content, extensions as $$
  select se.id, se.slug, se.title, se.summary, se.total, se.status::text,
    (select count(*)::int from content.series_posts sp join content.posts po on po.id = sp.post_id
       where sp.series_id = se.id and sp.accepted and po.status = 'published' and po.deleted_at is null),
    se.planned
  from content.series se
  where se.owner_id = auth.uid() and se.deleted_at is null
  order by se.updated_at desc;
$$;

-- ── the author's own fields (Studio) ─────────────────────────────────────────
create or replace function public.my_fields()
returns table (id uuid, slug text, title text, summary text, mark text, series_count int, published_posts int)
language sql stable security definer set search_path = public, content, extensions as $$
  select f.id, f.slug, f.title, f.summary, f.mark,
    (select count(*)::int from content.field_series fs where fs.field_id = f.id and fs.accepted),
    (select count(distinct po.id)::int
       from content.field_series fs
       join content.series_posts sp on sp.series_id = fs.series_id and sp.accepted
       join content.posts po on po.id = sp.post_id
       where fs.field_id = f.id and fs.accepted and po.status = 'published' and po.deleted_at is null)
  from content.fields f
  where f.owner_id = auth.uid() and f.deleted_at is null
  order by f.updated_at desc;
$$;

-- ── every public series across all authors (the /series aggregation) ─────────
drop function if exists public.list_public_series(int);
create or replace function public.list_public_series(p_limit int default 60)
returns table (
  slug            text,
  title           text,
  summary         text,
  owner_handle    citext,
  owner_name      text,
  field_slug      text,
  field_title     text,
  total           int,
  published       int,
  status          text,
  involved_handles citext[],
  involved_names   text[],
  tags            text[],
  latest          timestamptz
)
language sql stable security definer set search_path = public, content, extensions as $$
  with pub as (   -- published, accepted parts of each series, with their authors + tags
    select sp.series_id, po.id as post_id, po.author_id, po.pub_date, po.tags
    from content.series_posts sp
    join content.posts po on po.id = sp.post_id
    where sp.accepted and po.status = 'published' and po.visibility = 'public' and po.deleted_at is null
  )
  select
    se.slug, se.title, se.summary, pr.handle, pr.pen_name,
    fld.slug, fld.title,
    greatest(coalesce(se.total, 0), coalesce(array_length(se.planned, 1), 0), count(p.post_id)::int) as total,
    count(p.post_id)::int as published,
    coalesce(se.status::text, case when count(p.post_id) > 0 then 'in-progress' else 'planned' end),
    -- every author with a published part (owner first), and their names — the "involved" set
    (select array_agg(distinct pr2.handle) from content.profiles pr2 where pr2.id in (se.owner_id) or pr2.id in (select author_id from pub p2 where p2.series_id = se.id)),
    (select array_agg(distinct pr2.pen_name) from content.profiles pr2 where pr2.id in (se.owner_id) or pr2.id in (select author_id from pub p2 where p2.series_id = se.id)),
    (select array_agg(distinct t) from (select unnest(p3.tags) t from pub p3 where p3.series_id = se.id) u where t is not null),
    max(p.pub_date)
  from content.series se
  join content.profiles pr on pr.id = se.owner_id
  left join pub p on p.series_id = se.id
  left join lateral (
    select f.slug, f.title from content.field_series fs
    join content.fields f on f.id = fs.field_id and f.deleted_at is null
    where fs.series_id = se.id and fs.accepted order by f.created_at limit 1
  ) fld on true
  where se.deleted_at is null
  group by se.id, se.slug, se.title, se.summary, se.total, se.planned, se.status, se.owner_id, pr.handle, pr.pen_name, fld.slug, fld.title
  having count(p.post_id) > 0                          -- a series is public once it has a published part
  order by max(p.pub_date) desc nulls last
  limit least(greatest(p_limit, 1), 100);
$$;

revoke all on function public.my_series()             from public, anon;
revoke all on function public.my_fields()             from public, anon;
grant execute on function public.my_series()          to authenticated;
grant execute on function public.my_fields()          to authenticated;
grant execute on function public.list_public_series(int) to anon, authenticated;

notify pgrst, 'reload schema';
