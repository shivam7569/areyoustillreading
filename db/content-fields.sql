-- =============================================================================
-- db/content-fields.sql — the public "fields" read RPC (the Everyone shelf + /fields).
-- Public-schema SECURITY DEFINER over content.*, exposing only the shape a reader needs
-- to see a field on the shelf: its name, its generative-plate spec, and an honest
-- "N series · X of Y published" line. A field becomes PUBLIC once it gathers TWO series
-- (a single series is not yet a field). Aggregate only — no author PII, no drafts.
-- Idempotent. Depends on db/content.sql + db/content-collab.sql.
-- =============================================================================
create or replace function public.list_public_fields(p_limit int default 12)
returns table (
  slug            text,
  title           text,
  mark            text,
  series_count    int,
  published_posts int,
  total_posts     int,
  plate_spec      text   -- "parts:published,parts:published,…" for field-plates.js
)
language sql stable security definer set search_path = public, content, extensions as $$
  with fs as (
    -- every accepted series in every live field, with its declared length + how many parts are out
    select f.id as field_id, f.slug, f.title, f.mark, se.id as series_id,
           coalesce(se.total, cnt.total_posts) as parts,
           cnt.pub_posts as published
    from content.fields f
    join content.field_series x on x.field_id = f.id and x.accepted
    join content.series se on se.id = x.series_id and se.deleted_at is null
    cross join lateral (
      select count(*) filter (
               where po.status = 'published' and po.visibility = 'public' and po.deleted_at is null
             )::int as pub_posts,
             count(*)::int as total_posts
      from content.series_posts sp
      join content.posts po on po.id = sp.post_id
      where sp.series_id = se.id and sp.accepted
    ) cnt
    where f.deleted_at is null
  )
  select slug, title, mark,
         count(*)::int                                                    as series_count,
         sum(published)::int                                              as published_posts,
         sum(parts)::int                                                  as total_posts,
         string_agg(parts::text || ':' || published::text, ',' order by series_id) as plate_spec
  from fs
  group by field_id, slug, title, mark
  having count(*) >= 2   -- a field is public once it holds two series
  order by published_posts desc, series_count desc
  limit least(greatest(p_limit, 1), 40);
$$;

grant execute on function public.list_public_fields(int) to anon, authenticated;

-- VERIFY (optional): select slug, series_count, published_posts, total_posts, plate_spec
--                    from public.list_public_fields(6);
