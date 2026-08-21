-- =============================================================================
-- db/field-crossings.sql — the map + the real crossings for the /fields "The Crossings" section.
-- A crossing is where two series in a field take up the SAME subject — derived honestly from a
-- shared tag between their published parts (never an invented handoff or quote). Direction is
-- chronological and real: the earlier-published part RAISED the subject, the later one TOOK IT UP.
--   series_map : [{slug,title,handle,parts:[{slug,title,pos}]}]              — strands + nodes
--   crossings  : [{a:{title,slug,handle,series,pub}, b:{…}, subject}]        — a/b unordered;
--                the client orders them earlier→"raised", later→"taken up".
-- public.field_crossings(owner,slug) → one field.  public.all_field_crossings() → every public
-- field that has ≥1 crossing (one page-load round-trip). Idempotent.
-- Apply: node --env-file=.env scripts/apply-sql.mjs db/field-crossings.sql
-- =============================================================================

-- shared body: crossings + map for whichever field ids the caller narrows to.
drop function if exists public.field_crossings(text, text);
create or replace function public.field_crossings(p_owner_handle text, p_field_slug text)
returns table (series_map jsonb, crossings jsonb)
language sql stable security definer set search_path = public, content, extensions as $$
  with target as (
    select f.id from content.fields f
    join content.profiles pr on pr.id = f.owner_id
    where pr.handle = p_owner_handle and f.slug = p_field_slug and f.deleted_at is null
    limit 1
  ),
  fparts as (
    select se.id sid, se.slug sslug, se.title stitle, so.handle shandle,
           sp.position pos, po.id pid, po.slug pslug, po.title ptitle, po.tags, po.pub_date,
           pp.handle phandle
    from content.field_series fx
    join content.series se on se.id = fx.series_id and se.deleted_at is null
    join content.profiles so on so.id = se.owner_id
    join content.series_posts sp on sp.series_id = se.id and sp.accepted
    join content.posts po on po.id = sp.post_id
      and po.status = 'published' and po.visibility = 'public' and po.deleted_at is null
    join content.profiles pp on pp.id = po.author_id
    where fx.field_id = (select id from target) and fx.accepted
  ),
  smap as (
    select coalesce(jsonb_agg(s order by s->>'title'), '[]'::jsonb) j from (
      select jsonb_build_object('slug', sslug, 'title', stitle, 'handle', shandle,
        'parts', jsonb_agg(jsonb_build_object('slug', pslug, 'title', ptitle, 'pos', pos) order by pos)) s
      from fparts group by sid, sslug, stitle, shandle
    ) q
  ),
  pairs as (
    select
      jsonb_build_object(
        'a', jsonb_build_object('title', a.ptitle, 'slug', a.pslug, 'handle', a.phandle, 'series', a.stitle, 'pub', a.pub_date),
        'b', jsonb_build_object('title', b.ptitle, 'slug', b.pslug, 'handle', b.phandle, 'series', b.stitle, 'pub', b.pub_date),
        'subject', (select t from unnest(a.tags) t where t = any (b.tags) limit 1)
      ) c
    from fparts a
    join fparts b on a.sid < b.sid and a.tags && b.tags     -- different series, a shared subject
    order by a.pub_date, b.pub_date
    limit 24
  ),
  cx as (select coalesce(jsonb_agg(c), '[]'::jsonb) j from pairs)
  select (select j from smap), (select j from cx);
$$;
grant execute on function public.field_crossings(text, text) to anon, authenticated;

-- batch: every public field that actually has a crossing, in one call (the /fields page loader).
drop function if exists public.all_field_crossings();
create or replace function public.all_field_crossings()
returns table (owner_handle text, field_slug text, field_title text, series_map jsonb, crossings jsonb)
language sql stable security definer set search_path = public, content, extensions as $$
  select pr.handle::text, f.slug::text, f.title::text, fc.series_map, fc.crossings
  from content.fields f
  join content.profiles pr on pr.id = f.owner_id
  cross join lateral public.field_crossings(pr.handle::text, f.slug::text) fc
  where f.deleted_at is null
    and fc.crossings is not null
    and jsonb_array_length(fc.crossings) > 0
  order by jsonb_array_length(fc.crossings) desc, f.title;
$$;
grant execute on function public.all_field_crossings() to anon, authenticated;

notify pgrst, 'reload schema';
