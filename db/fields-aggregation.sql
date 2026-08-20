-- =============================================================================
-- db/fields-aggregation.sql — public.list_public_fields_full for the /fields directory.
-- Every public field (≥2 accepted series with a published part), with its owner, the INVOLVED
-- authors (everyone with a published part in it), counts, total minutes, running-since, the
-- field mark + plate spec ("total:published,…" for field-marks.js), and the member series
-- (title, owner, counts, minutes, status) as jsonb. Grouped-by-author on the client.
-- Idempotent. Apply: node --env-file=.env scripts/apply-sql.mjs db/fields-aggregation.sql
-- =============================================================================
drop function if exists public.list_public_fields_full(int);
create or replace function public.list_public_fields_full(p_limit int default 24)
returns table (
  slug text, title text, summary text, mark text,
  owner_handle citext, owner_name text,
  series_count int, published_posts int, total_posts int, total_mins int, running_since timestamptz,
  involved_handles citext[], involved_names text[],
  plate_spec text, member_series jsonb
)
language sql stable security definer set search_path = public, content, extensions as $$
  with fseries as (
    select f.id fid, f.slug fslug, f.title ftitle, f.summary fsummary, f.mark, f.owner_id fowner,
           x.position pos, se.id sid, se.slug sslug, se.title stitle, se.status sstatus, se.total sdecl,
           so.handle sohandle, so.pen_name soname,
           cnt.pub, cnt.tot, cnt.mins, cnt.first_at
    from content.fields f
    join content.field_series x on x.field_id = f.id and x.accepted
    join content.series se on se.id = x.series_id and se.deleted_at is null
    join content.profiles so on so.id = se.owner_id
    cross join lateral (
      select count(*) filter (where po.status='published' and po.visibility='public' and po.deleted_at is null)::int pub,
             count(*)::int tot,
             coalesce(sum(po.reading_min) filter (where po.status='published' and po.visibility='public' and po.deleted_at is null), 0)::int mins,
             min(po.pub_date) filter (where po.status='published' and po.deleted_at is null) first_at
      from content.series_posts sp join content.posts po on po.id = sp.post_id
      where sp.series_id = se.id and sp.accepted
    ) cnt
    where f.deleted_at is null
  ),
  involved as (
    select fs.fid, array_agg(distinct pr.handle) handles, array_agg(distinct pr.pen_name) names
    from fseries fs
    join content.series_posts sp on sp.series_id = fs.sid and sp.accepted
    join content.posts po on po.id = sp.post_id and po.status='published' and po.visibility='public' and po.deleted_at is null
    join content.post_authors pa on pa.post_id = po.id and pa.accepted
    join content.profiles pr on pr.id = pa.user_id
    group by fs.fid
  )
  select
    f.fslug, f.ftitle, f.fsummary, f.mark, fo.handle, fo.pen_name,
    count(*)::int, sum(f.pub)::int, sum(f.tot)::int, sum(f.mins)::int, min(f.first_at),
    inv.handles, inv.names,
    string_agg(coalesce(f.sdecl, f.tot) || ':' || f.pub, ',' order by f.pos),
    jsonb_agg(jsonb_build_object(
      'title', f.stitle, 'slug', f.sslug, 'owner_handle', f.sohandle, 'owner_name', f.soname,
      'published', f.pub, 'total', coalesce(f.sdecl, f.tot), 'mins', f.mins,
      'status', coalesce(f.sstatus::text, 'in-progress')) order by f.pos)
  from fseries f
  join content.profiles fo on fo.id = f.fowner
  left join involved inv on inv.fid = f.fid
  group by f.fid, f.fslug, f.ftitle, f.fsummary, f.mark, fo.handle, fo.pen_name, inv.handles, inv.names
  having count(*) >= 2 and sum(f.pub) > 0
  order by sum(f.pub) desc
  limit least(greatest(p_limit, 1), 40);
$$;

grant execute on function public.list_public_fields_full(int) to anon, authenticated;
notify pgrst, 'reload schema';
