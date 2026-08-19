-- =============================================================================
-- db/content-serve.sql — Phase 2: the PUBLIC read API over content.*
-- -----------------------------------------------------------------------------
-- content.* stays UNEXPOSED to PostgREST. These public-schema SECURITY DEFINER
-- functions are the only window onto it for readers: each returns ONLY public-safe
-- columns of PUBLISHED, public, non-deleted posts (never body_md, drafts, private,
-- or another author's private data). They are granted to anon+authenticated — this
-- is the public read API the site (and, later, the edge) calls. Fixed queries, no
-- dynamic SQL. Pinned search_path (content + extensions for citext) is the required
-- escalation defense on a definer function.
--
-- Idempotent; run in the Supabase SQL editor or via `node scripts/apply-sql.mjs db/content-serve.sql`.
-- Depends on db/content.sql.
-- =============================================================================

-- Recent published posts across ALL authors (the global feed). Keyset via p_before.
create or replace function public.list_public_posts(p_limit int default 20, p_before timestamptz default null)
returns table (handle citext, pen_name text, slug text, title text, description text, tags text[], pub_date timestamptz, reading_min int)
language sql stable security definer set search_path = public, content, extensions as $$
  select pr.handle, pr.pen_name, po.slug, po.title, po.description, po.tags, po.pub_date, po.reading_min
  from content.posts po
  join content.profiles pr on pr.id = po.author_id
  where po.status = 'published' and po.visibility = 'public' and po.deleted_at is null
    and (p_before is null or po.pub_date < p_before)
  order by po.pub_date desc nulls last
  limit least(greatest(p_limit, 1), 50);
$$;

-- One author's public profile + published-post count.
create or replace function public.get_public_author(p_handle text)
returns table (handle citext, pen_name text, bio text, post_count bigint)
language sql stable security definer set search_path = public, content, extensions as $$
  select pr.handle, pr.pen_name, pr.bio,
    (select count(*) from content.posts po
       where po.author_id = pr.id and po.status = 'published' and po.visibility = 'public' and po.deleted_at is null)
  from content.profiles pr
  where pr.handle = p_handle and pr.deleted_at is null;
$$;

-- One author's published posts (their @handle page).
create or replace function public.list_author_posts(p_handle text, p_limit int default 50)
returns table (slug text, title text, description text, tags text[], pub_date timestamptz, reading_min int)
language sql stable security definer set search_path = public, content, extensions as $$
  select po.slug, po.title, po.description, po.tags, po.pub_date, po.reading_min
  from content.posts po
  join content.profiles pr on pr.id = po.author_id
  where pr.handle = p_handle
    and po.status = 'published' and po.visibility = 'public' and po.deleted_at is null
  order by po.pub_date desc nulls last
  limit least(greatest(p_limit, 1), 100);
$$;

-- One published post by @handle + slug (public-safe columns incl. the inert body_html).
create or replace function public.get_public_post(p_handle text, p_slug text)
returns table (handle citext, pen_name text, slug text, title text, description text, body_html text, tags text[], pub_date timestamptz, updated_date timestamptz, reading_min int)
language sql stable security definer set search_path = public, content, extensions as $$
  select pr.handle, pr.pen_name, po.slug, po.title, po.description, po.body_html, po.tags, po.pub_date, po.updated_date, po.reading_min
  from content.posts po
  join content.profiles pr on pr.id = po.author_id
  where pr.handle = p_handle and po.slug = p_slug
    and po.status = 'published' and po.visibility = 'public' and po.deleted_at is null;
$$;

-- The public read API — callable by anyone (returns only published, public data).
grant execute on function public.list_public_posts(int, timestamptz) to anon, authenticated;
grant execute on function public.get_public_author(text)             to anon, authenticated;
grant execute on function public.list_author_posts(text, int)        to anon, authenticated;
grant execute on function public.get_public_post(text, text)         to anon, authenticated;

-- VERIFY (optional):
--   select * from public.list_public_posts(5, null);
--   select * from public.get_public_post('shivam', 'feature-test');
