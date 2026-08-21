-- =============================================================================
-- db/topic-pages.sql — the two RPCs behind the DB-driven /blog/tags topic pages (subject pages),
-- replacing the old file-collection tag archive. All from real published, public content.posts.
--   topic_tags()          → every distinct subject + its post count (build-time route list + index)
--   posts_by_tag(p_tag)   → the published posts carrying a subject, across ALL authors, newest-first
-- Both anon-callable (public reader surface). Idempotent.
-- Apply: node --env-file=.env scripts/apply-sql.mjs db/topic-pages.sql
-- =============================================================================
drop function if exists public.topic_tags();
create or replace function public.topic_tags()
returns table (tag text, n int)
language sql stable security definer set search_path = content, public, extensions as $$
  select lower(trim(t)) as tag, count(distinct po.id)::int as n
  from content.posts po
  cross join lateral unnest(po.tags) t
  where po.status = 'published' and po.visibility = 'public' and po.deleted_at is null
    and length(trim(t)) > 0
  group by lower(trim(t))
  order by n desc, tag;
$$;
grant execute on function public.topic_tags() to anon, authenticated;

drop function if exists public.posts_by_tag(text);
create or replace function public.posts_by_tag(p_tag text)
returns table (
  slug text, title text, description text, pub_date timestamptz, reading_min int,
  tags text[], primary_handle citext, primary_name text, author_count int
)
language sql stable security definer set search_path = content, public, extensions as $$
  select po.slug, po.title, po.description, po.pub_date, po.reading_min, po.tags,
         pp.handle, coalesce(pp.pen_name, pp.handle),
         (select count(*)::int from content.post_authors pa where pa.post_id = po.id and pa.accepted)
  from content.posts po
  join content.profiles pp on pp.id = po.author_id
  where po.status = 'published' and po.visibility = 'public' and po.deleted_at is null
    and exists (select 1 from unnest(po.tags) t where lower(trim(t)) = lower(trim(p_tag)))
  order by po.pub_date desc nulls last
  limit 200;
$$;
grant execute on function public.posts_by_tag(text) to anon, authenticated;

notify pgrst, 'reload schema';
