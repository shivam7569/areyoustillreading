-- =============================================================================
-- db/posts-meta-by-ids.sql — public.posts_meta_by_ids: resolve a set of post UUIDs to their
-- title + canonical /@handle/slug, for the reader account's "Notes & highlights" section.
-- On a DB post the reader islands key marks by the post's UUID (assemble-permalink substitutes
-- AYSRZZUUID → post_id); the account used to label them from the now-deleted file collection.
-- Only published, public posts resolve — a highlight on a since-unpublished post drops off.
-- Idempotent. Apply: node --env-file=.env scripts/apply-sql.mjs db/posts-meta-by-ids.sql
-- =============================================================================
drop function if exists public.posts_meta_by_ids(uuid[]);
create or replace function public.posts_meta_by_ids(p_ids uuid[])
returns table (id uuid, slug text, title text, handle citext)
language sql stable security definer set search_path = public, content, extensions as $$
  select po.id, po.slug, po.title, pr.handle
  from content.posts po
  join content.profiles pr on pr.id = po.author_id
  where po.id = any (p_ids)
    and po.status = 'published' and po.visibility = 'public' and po.deleted_at is null;
$$;
grant execute on function public.posts_meta_by_ids(uuid[]) to anon, authenticated;
notify pgrst, 'reload schema';
