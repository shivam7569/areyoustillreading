-- =============================================================================
-- db/content-author.sql — read RPCs for the /@handle author page.
-- Public-schema SECURITY DEFINER over content.* + public.analytics_events. Everything the
-- author masthead / "writes in" / "series they run" bands need, resolved by @handle. Honest
-- signals only (a reading SHAPE, counts of work) — never a score or a follower count.
-- Idempotent. Depends on db/content.sql + db/content-collab.sql + db/analytics.sql.
-- =============================================================================

-- ── masthead stats + the author's signature reading shape ────────────────────
-- Aggregate retention across ALL their published posts → one shape (readers-remaining per
-- decile), plus the plain facts. signature is null until there are enough reads to mean anything.
create or replace function public.get_author_stats(p_handle text)
returns table (post_count int, since_year int, field_count int, series_count int, longest_min int, signature int[])
language sql stable security definer set search_path = public, content, extensions as $$
  with me as (select id from content.profiles where handle = p_handle and deleted_at is null),
  posts as (
    select p.slug, p.reading_min, p.pub_date
    from content.posts p
    join content.post_authors pa on pa.post_id = p.id and pa.accepted
    where pa.user_id = (select id from me)
      and p.status = 'published' and p.visibility = 'public' and p.deleted_at is null
  ),
  reads as (
    select count(*)::numeric n from public.analytics_events e
    where e.type = 'read' and e.slug in (select slug from posts)
  )
  select
    (select count(*)::int from posts),
    (select extract(year from min(pub_date))::int from posts),
    -- public fields (>=2 accepted series) they own — matches the "Writes in" band
    (select count(*)::int from content.fields f
       where f.owner_id = (select id from me) and f.deleted_at is null
         and (select count(*) from content.field_series x where x.field_id = f.id and x.accepted) >= 2),
    -- series they own that have >=1 published part — matches the "Series they run" band
    (select count(*)::int from content.series s
       where s.owner_id = (select id from me) and s.deleted_at is null
         and exists (select 1 from content.series_posts sp join content.posts po on po.id = sp.post_id
                     where sp.series_id = s.id and sp.accepted
                       and po.status='published' and po.visibility='public' and po.deleted_at is null)),
    (select max(reading_min)::int from posts),
    case when (select n from reads) >= 8 then (
      select array_agg(
        round(100.0 * (
          select count(*) from public.analytics_events e2
          where e2.type = 'read' and e2.slug in (select slug from posts) and e2.read_pct >= g.x
        ) / (select n from reads))::int order by g.x)
      from generate_series(10, 100, 10) g(x)
    ) else null end;
$$;

-- ── "Writes in": the author's own public fields (>=2 accepted series), newest series first,
--    each with its nested accepted series (title + published/total parts) as jsonb ───────────
create or replace function public.author_fields(p_handle text)
returns table (slug text, title text, mark text, series_count int, published_parts int, total_parts int, series jsonb)
language sql stable security definer set search_path = public, content, extensions as $$
  with me as (select id from content.profiles where handle = p_handle and deleted_at is null),
  fs as (
    select f.id as field_id, f.slug, f.title, f.mark, se.id as series_id, se.title as series_title,
           coalesce(se.total, cnt.total_posts) as parts, cnt.pub_posts as published
    from content.fields f
    join content.field_series x on x.field_id = f.id and x.accepted
    join content.series se on se.id = x.series_id and se.deleted_at is null
    cross join lateral (
      select count(*) filter (where po.status='published' and po.visibility='public' and po.deleted_at is null)::int pub_posts,
             count(*)::int total_posts
      from content.series_posts sp join content.posts po on po.id = sp.post_id
      where sp.series_id = se.id and sp.accepted
    ) cnt
    where f.owner_id = (select id from me) and f.deleted_at is null
  )
  select slug, title, mark, count(*)::int, sum(published)::int, sum(parts)::int,
    jsonb_agg(jsonb_build_object('title', series_title, 'published', published, 'total', parts) order by series_title)
  from fs
  group by field_id, slug, title, mark
  having count(*) >= 2
  order by sum(published) desc, count(*) desc;
$$;

-- ── "Series they run": series the author OWNS (blurb, field, progress, first part) + a flag
--    for series they only CONTRIBUTED a part to (someone else runs) → the design's snote ─────
create or replace function public.author_series(p_handle text)
returns table (
  slug text, title text, summary text, status text, field_title text,
  published int, total int, start_owner_handle citext, start_handle citext, start_slug text, is_owner boolean
)
language sql stable security definer set search_path = public, content, extensions as $$
  with me as (select id from content.profiles where handle = p_handle and deleted_at is null),
  -- every series the author either owns OR has an accepted published part in
  cand as (
    select distinct se.id
    from content.series se
    where se.deleted_at is null and (
      se.owner_id = (select id from me)
      or exists (
        select 1 from content.series_posts sp
        join content.posts po on po.id = sp.post_id
        join content.post_authors pa on pa.post_id = po.id and pa.user_id = (select id from me) and pa.accepted
        where sp.series_id = se.id and sp.accepted
          and po.status='published' and po.visibility='public' and po.deleted_at is null
      )
    )
  )
  select se.slug, se.title, se.summary, se.status,
    fld.title,
    cnt.pub_posts, coalesce(se.total, cnt.total_posts),
    so.handle, st.handle, st.slug,
    (se.owner_id = (select id from me))
  from cand
  join content.series se on se.id = cand.id
  join content.profiles so on so.id = se.owner_id
  cross join lateral (
    select count(*) filter (where po.status='published' and po.visibility='public' and po.deleted_at is null)::int pub_posts,
           count(*)::int total_posts
    from content.series_posts sp join content.posts po on po.id = sp.post_id
    where sp.series_id = se.id and sp.accepted
  ) cnt
  left join lateral (
    select f.title from content.field_series x join content.fields f on f.id = x.field_id and f.deleted_at is null
    where x.series_id = se.id and x.accepted order by f.created_at limit 1
  ) fld on true
  left join lateral (
    select pp.handle, po.slug from content.series_posts sp
    join content.posts po on po.id = sp.post_id and po.status='published' and po.visibility='public' and po.deleted_at is null
    join content.profiles pp on pp.id = po.author_id
    where sp.series_id = se.id and sp.accepted order by sp.position limit 1
  ) st on true
  where cnt.pub_posts >= 1
  order by (se.owner_id = (select id from me)) desc, se.created_at;
$$;

grant execute on function public.get_author_stats(text) to anon, authenticated;
grant execute on function public.author_fields(text)     to anon, authenticated;
grant execute on function public.author_series(text)      to anon, authenticated;

-- VERIFY: select * from public.get_author_stats('gradghost');
--         select slug, title, series_count, series from public.author_fields('gradghost');
--         select slug, title, is_owner, published, total from public.author_series('gradghost');
