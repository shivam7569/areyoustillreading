-- =============================================================================
-- db/series-gaps.sql — public.series_gaps: the real publication rhythm of a series + the return
-- rate across each gap, for the /series "The Gap" section. Published parts placed by their real
-- pub_date; the gap between two parts is the months between them; the return rate is, of the
-- readers who finished part N, how many also read part N+1 (from reader_progress). return_pct is
-- NULL when too few readers to be meaningful (<4) — shown as "not enough reads yet", never faked.
-- Idempotent. Apply: node --env-file=.env scripts/apply-sql.mjs db/series-gaps.sql
-- =============================================================================
drop function if exists public.series_gaps(text, text);
create or replace function public.series_gaps(p_owner_handle text, p_series_slug text)
returns table (
  seq int, part int, title text, slug text, primary_handle citext,
  pub_date timestamptz, reading_min int, readers int, return_pct int
)
language sql stable security definer set search_path = public, content, extensions as $$
  with target as (
    select se.id from content.series se
    join content.profiles pr on pr.id = se.owner_id
    where pr.handle = p_owner_handle and se.slug = p_series_slug and se.deleted_at is null
    limit 1
  ),
  parts as (
    -- published, accepted parts in order (return-rate analysis is between things that are actually out)
    select row_number() over (order by sp.position, po.pub_date) as pos,
           sp.position, po.slug, po.title, po.pub_date, po.reading_min, pp.handle as primary_handle
    from content.series_posts sp
    join content.posts po on po.id = sp.post_id
      and po.status = 'published' and po.visibility = 'public' and po.deleted_at is null
    join content.profiles pp on pp.id = po.author_id
    where sp.series_id = (select id from target) and sp.accepted
  ),
  rd as (
    select p.pos, p.slug,
      (select array_agg(rp.user_id) from public.reader_progress rp
        where rp.post_slug = p.slug and (rp.read or rp.pct >= 70)) as readers
    from parts p
  )
  select
    p.pos::int, p.position, p.title, p.slug, p.primary_handle, p.pub_date, p.reading_min,
    coalesce(array_length(rd.readers, 1), 0) as readers,
    case
      when nx.pos is not null and coalesce(array_length(rd.readers, 1), 0) >= 4
      then round(100.0 * (select count(*) from unnest(rd.readers) u where u = any(rdn.readers))
                 / array_length(rd.readers, 1))::int
      else null
    end as return_pct
  from parts p
  join rd on rd.pos = p.pos
  left join parts nx on nx.pos = p.pos + 1
  left join rd rdn on rdn.pos = nx.pos
  order by p.pos;
$$;

grant execute on function public.series_gaps(text, text) to anon, authenticated;
notify pgrst, 'reload schema';
