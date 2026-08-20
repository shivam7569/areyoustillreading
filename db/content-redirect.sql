-- =============================================================================
-- db/content-redirect.sql — resolve a bare /blog/<slug> to its canonical /@handle/slug.
-- The one-URL collapse: every post lives at exactly one URL (/@handle/slug), and the
-- legacy single-author /blog/<slug> URLs 301 to it. The legacy file posts were migrated
-- into content.posts (source_path set) keeping their slug, so this returns the owning
-- author's handle for the root middleware to redirect to. Only a MIGRATED (source_path
-- not null), published, public post resolves — a bare /blog/<slug> that was never a file
-- post returns nothing and the middleware falls through (static 404). Idempotent.
-- Apply:  node --env-file=.env scripts/apply-sql.mjs db/content-redirect.sql
-- =============================================================================
create or replace function public.get_blog_canonical(p_slug text)
returns table (handle citext, slug text)
language sql stable security definer set search_path = public, content, extensions as $$
  select pr.handle, po.slug
  from content.posts po
  join content.profiles pr on pr.id = po.author_id
  where po.slug = p_slug
    and po.status = 'published' and po.visibility = 'public' and po.deleted_at is null
    and po.source_path is not null   -- a migrated legacy file post (the only ones that ever had a /blog/<slug> URL)
  order by po.created_at
  limit 1;
$$;
revoke all on function public.get_blog_canonical(text) from public;
grant execute on function public.get_blog_canonical(text) to anon, authenticated;

notify pgrst, 'reload schema';
