-- =============================================================================
-- db/reading-pairs.sql — public.reading_pairs: cross-author pairs for the /blog "Read them
-- together" section. A pair is two published posts by DIFFERENT authors that reach the SAME subject
-- (a shared tag) — the thing only a feed of many authors can offer. One pair per subject (the two
-- most recent posts on it, by two different people), deduped so the same two posts never repeat,
-- most-recent first, capped. Direction is chronological and real: the client reads earlier→"read
-- first", later→"then this". No invented "they disagree" claim, no fabricated quotes.
--   subject : the shared tag
--   a, b    : {title,slug,handle,name,pub,mins,desc}  (unordered; client orders by pub)
-- Idempotent. Apply: node --env-file=.env scripts/apply-sql.mjs db/reading-pairs.sql
-- =============================================================================
drop function if exists public.reading_pairs();
create or replace function public.reading_pairs()
returns table (subject text, a jsonb, b jsonb)
language sql stable security definer set search_path = public, content, extensions as $$
  with pub as (
    select po.id, po.slug, po.title, po.pub_date, po.reading_min, po.description,
           po.author_id, pp.handle, pp.pen_name, lower(trim(t)) as tag
    from content.posts po
    join content.profiles pp on pp.id = po.author_id
    cross join lateral unnest(po.tags) t
    where po.status = 'published' and po.visibility = 'public' and po.deleted_at is null
      and po.tags is not null and length(trim(t)) > 0
  ),
  ranked as (
    select *, row_number() over (partition by tag order by pub_date desc, id) rn from pub
  ),
  lead as (select * from ranked where rn = 1),                         -- most recent post per subject
  partner as (                                                          -- most recent DIFFERENT author on it
    select distinct on (r.tag) r.*
    from ranked r join lead on lead.tag = r.tag
    where r.author_id <> lead.author_id
    order by r.tag, r.pub_date desc, r.id
  ),
  obj as (
    select lead.tag as subject, lead.id aid, partner.id bid,
      jsonb_build_object('title', lead.title, 'slug', lead.slug, 'handle', lead.handle,
        'name', coalesce(lead.pen_name, lead.handle), 'pub', lead.pub_date, 'mins', lead.reading_min, 'desc', lead.description) aj,
      jsonb_build_object('title', partner.title, 'slug', partner.slug, 'handle', partner.handle,
        'name', coalesce(partner.pen_name, partner.handle), 'pub', partner.pub_date, 'mins', partner.reading_min, 'desc', partner.description) bj,
      greatest(lead.pub_date, partner.pub_date) recency
    from lead join partner on partner.tag = lead.tag
  ),
  deduped as (
    select distinct on (least(aid, bid), greatest(aid, bid)) subject, aj, bj, recency
    from obj
    order by least(aid, bid), greatest(aid, bid), recency desc
  )
  select subject, aj, bj from deduped order by recency desc limit 12;
$$;
grant execute on function public.reading_pairs() to anon, authenticated;
notify pgrst, 'reload schema';
