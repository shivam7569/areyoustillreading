-- =============================================================================
-- db/owner-all-posts.sql — public.owner_all_posts: every DB post across ALL authors, for the
-- OWNER's Studio catalog. Since publishing now goes to content.posts for everyone (owner included),
-- the owner's file-based Posts/Home didn't show their own new posts OR any author's — this fills
-- that gap. Owner-only: the content.is_owner guard makes it return nothing for anyone else.
-- Idempotent. Apply: node --env-file=.env scripts/apply-sql.mjs db/owner-all-posts.sql
-- =============================================================================
drop function if exists public.owner_all_posts();
create or replace function public.owner_all_posts()
returns table (
  id uuid, slug text, title text, status text, visibility text,
  pub_date timestamptz, publish_at timestamptz, tags text[], reading_min int,
  author_handle text, author_name text, is_owner_post boolean
)
language sql stable security definer set search_path = public, content, extensions as $$
  select po.id, po.slug, po.title, po.status::text, po.visibility::text,
         po.pub_date, po.publish_at, po.tags, po.reading_min,
         pr.handle::text, coalesce(pr.pen_name, pr.handle)::text, (po.author_id = auth.uid())
  from content.posts po
  join content.profiles pr on pr.id = po.author_id
  where po.deleted_at is null
    and content.is_owner(auth.uid())      -- owner-only; a non-owner caller gets an empty set
  order by coalesce(po.pub_date, po.updated_at) desc;
$$;
grant execute on function public.owner_all_posts() to authenticated;
notify pgrst, 'reload schema';
