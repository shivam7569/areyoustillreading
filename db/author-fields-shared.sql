-- =============================================================================
-- db/author-fields-shared.sql — decision 12 for FIELDS: a shared field appears on EVERY involved
-- author's /@handle page, not only the owner's. author_fields previously returned only fields the
-- author OWNS; now it also returns fields that contain an accepted series the author owns
-- (contributed), and returns is_owner + owner_name so the author page can mark a shared field
-- "run by X" — mirroring what author_series already does for series. Idempotent.
-- Apply: node --env-file=.env scripts/apply-sql.mjs db/author-fields-shared.sql
-- =============================================================================
drop function if exists public.author_fields(text);
create or replace function public.author_fields(p_handle text)
returns table (
  slug text, title text, mark text, series_count int, published_parts int, total_parts int,
  is_owner boolean, owner_handle text, owner_name text, series jsonb
)
language sql stable security definer set search_path = public, content, extensions as $$
  with me as (select id from content.profiles where handle = p_handle and deleted_at is null),
  fs as (
    select f.id as field_id, f.slug, f.title, f.mark, f.owner_id,
           se.id as series_id, se.title as series_title,
           coalesce(se.total, cnt.total_posts) as parts, cnt.pub_posts as published
    from content.fields f
    join content.field_series x on x.field_id = f.id and x.accepted
    join content.series se on se.id = x.series_id and se.deleted_at is null
    cross join lateral (
      select count(*) filter (where po.status = 'published' and po.visibility = 'public' and po.deleted_at is null)::int pub_posts,
             count(*)::int total_posts
      from content.series_posts sp join content.posts po on po.id = sp.post_id
      where sp.series_id = se.id and sp.accepted
    ) cnt
    where f.deleted_at is null and (
      f.owner_id = (select id from me)                                     -- fields the author runs
      or exists (select 1 from content.field_series fx                     -- OR fields holding their series
                 join content.series se2 on se2.id = fx.series_id
                 where fx.field_id = f.id and fx.accepted
                   and se2.owner_id = (select id from me) and se2.deleted_at is null)
    )
  )
  select fs.slug, fs.title, fs.mark, count(*)::int, sum(fs.published)::int, sum(fs.parts)::int,
    bool_or(fs.owner_id = (select id from me)) as is_owner,
    (select pr.handle::text from content.profiles pr where pr.id = fs.owner_id) as owner_handle,
    (select coalesce(pr.pen_name, pr.handle::text) from content.profiles pr where pr.id = fs.owner_id) as owner_name,
    jsonb_agg(jsonb_build_object('title', fs.series_title, 'published', fs.published, 'total', fs.parts) order by fs.series_title)
  from fs
  group by fs.field_id, fs.slug, fs.title, fs.mark, fs.owner_id
  having count(*) >= 2
  order by sum(fs.published) desc, count(*) desc;
$$;
grant execute on function public.author_fields(text) to anon, authenticated;
notify pgrst, 'reload schema';
