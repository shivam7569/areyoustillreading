-- =============================================================================
-- db/content-permalink.sql — the PUBLIC read API for the DB-served permalink pages.
-- Public-schema SECURITY DEFINER over content.*, published/public/non-deleted only.
-- Everything a reader-facing permalink needs, resolved by @handle:
--   get_public_post        — one post at /@primaryhandle/slug (inert body_html + co-authors
--                            + series & field crumbs). PRIMARY author's handle is canonical.
--   get_public_author      — an author's public profile + count of ANY accepted-author work.
--   list_author_posts_multi— that author's posts, each linking to its OWN canonical permalink.
--   get_public_series /     — an owner-scoped series (/@handle/s/slug): meta + ordered parts.
--   list_series_posts          A series is public once it has >=1 accepted published part.
--   get_public_field /      — an owner-scoped field (/@handle/f/slug): meta + ordered series.
--   list_field_series          A field is public once it holds >=2 accepted series.
-- Pinned search_path (content + extensions for citext) — the escalation defense on a definer.
-- Idempotent. Depends on db/content.sql + db/content-collab.sql.
-- =============================================================================

-- ── one post ────────────────────────────────────────────────────────────────
-- Return shape changed (post_id/avatar/co-authors/crumbs) → drop before recreate.
drop function if exists public.get_public_post(text, text);
create or replace function public.get_public_post(p_handle text, p_slug text)
returns table (
  post_id             uuid,
  slug                text,
  title               text,
  description         text,
  body_html           text,
  tags                text[],
  pub_date            timestamptz,
  updated_date        timestamptz,
  reading_min         int,
  primary_handle      citext,
  primary_name        text,
  primary_avatar      text,
  authors             jsonb,   -- [{handle,name,avatar}] accepted, ordered by byline position
  series_owner_handle citext,
  series_slug         text,
  series_title        text,
  series_part         int,
  series_total        int,
  field_owner_handle  citext,
  field_slug          text,
  field_title         text
)
language sql stable security definer set search_path = public, content, extensions as $$
  select
    po.id, po.slug, po.title, po.description, po.body_html, po.tags, po.pub_date, po.updated_date, po.reading_min,
    pr.handle, pr.pen_name, pr.avatar_url,
    (select coalesce(jsonb_agg(
              jsonb_build_object('handle', p2.handle, 'name', p2.pen_name, 'avatar', p2.avatar_url)
              order by pa.position), '[]'::jsonb)
       from content.post_authors pa
       join content.profiles p2 on p2.id = pa.user_id
       where pa.post_id = po.id and pa.accepted),
    ser.owner_handle, ser.slug, ser.title, ser.part, ser.total,
    fld.owner_handle, fld.slug, fld.title
  from content.posts po
  join content.profiles pr on pr.id = po.author_id
  -- one series crumb (owner handle scopes its URL) …
  left join lateral (
    select so.handle as owner_handle, se.slug, se.title, sp.position as part, se.total, se.id as series_id
    from content.series_posts sp
    join content.series se on se.id = sp.series_id and se.deleted_at is null
    join content.profiles so on so.id = se.owner_id
    where sp.post_id = po.id and sp.accepted
    order by se.created_at
    limit 1
  ) ser on true
  -- … and the field that series sits in
  left join lateral (
    select fo.handle as owner_handle, f.slug, f.title
    from content.field_series fs
    join content.fields f on f.id = fs.field_id and f.deleted_at is null
    join content.profiles fo on fo.id = f.owner_id
    where fs.series_id = ser.series_id and fs.accepted
    order by f.created_at
    limit 1
  ) fld on true
  where pr.handle = p_handle and po.slug = p_slug
    and po.status = 'published' and po.visibility = 'public' and po.deleted_at is null;
$$;

-- ── an author's profile ─────────────────────────────────────────────────────
-- Now counts ANY accepted-author work (not just author_id) → drop before recreate.
drop function if exists public.get_public_author(text);
create or replace function public.get_public_author(p_handle text)
returns table (handle citext, pen_name text, bio text, avatar_url text, post_count bigint)
language sql stable security definer set search_path = public, content, extensions as $$
  select pr.handle, pr.pen_name, pr.bio, pr.avatar_url,
    (select count(distinct po.id)
       from content.post_authors pa
       join content.posts po on po.id = pa.post_id
       where pa.user_id = pr.id and pa.accepted
         and po.status = 'published' and po.visibility = 'public' and po.deleted_at is null)
  from content.profiles pr
  where pr.handle = p_handle and pr.deleted_at is null;
$$;

-- ── an author's posts (each links to its OWN canonical permalink) ────────────
create or replace function public.list_author_posts_multi(p_handle text, p_limit int default 50)
returns table (
  slug text, title text, description text, tags text[], pub_date timestamptz, reading_min int,
  primary_handle citext, author_names text[]
)
language sql stable security definer set search_path = public, content, extensions as $$
  select po.slug, po.title, po.description, po.tags, po.pub_date, po.reading_min,
    pp.handle,
    (select array_agg(p2.pen_name order by pa2.position)
       from content.post_authors pa2 join content.profiles p2 on p2.id = pa2.user_id
       where pa2.post_id = po.id and pa2.accepted)
  from content.profiles pr
  join content.post_authors pa on pa.user_id = pr.id and pa.accepted
  join content.posts po on po.id = pa.post_id
    and po.status = 'published' and po.visibility = 'public' and po.deleted_at is null
  join content.profiles pp on pp.id = po.author_id     -- primary author → canonical @handle
  where pr.handle = p_handle
  order by po.pub_date desc nulls last
  limit least(greatest(p_limit, 1), 100);
$$;

-- ── one series (owner-scoped) ───────────────────────────────────────────────
create or replace function public.get_public_series(p_owner_handle text, p_series_slug text)
returns table (owner_handle citext, owner_name text, slug text, title text, summary text, total int, status text, published_count int)
language sql stable security definer set search_path = public, content, extensions as $$
  select o.handle, o.pen_name, se.slug, se.title, se.summary, se.total, se.status,
    (select count(*)::int from content.series_posts sp
       join content.posts po on po.id = sp.post_id
       where sp.series_id = se.id and sp.accepted
         and po.status = 'published' and po.visibility = 'public' and po.deleted_at is null)
  from content.series se
  join content.profiles o on o.id = se.owner_id
  where o.handle = p_owner_handle and se.slug = p_series_slug and se.deleted_at is null
    and exists (select 1 from content.series_posts sp
                join content.posts po on po.id = sp.post_id
                where sp.series_id = se.id and sp.accepted
                  and po.status = 'published' and po.visibility = 'public' and po.deleted_at is null);
$$;

create or replace function public.list_series_posts(p_owner_handle text, p_series_slug text)
returns table (part int, slug text, title text, description text, reading_min int, primary_handle citext, author_names text[])
language sql stable security definer set search_path = public, content, extensions as $$
  select sp.position, po.slug, po.title, po.description, po.reading_min,
    pp.handle,
    (select array_agg(p2.pen_name order by pa2.position)
       from content.post_authors pa2 join content.profiles p2 on p2.id = pa2.user_id
       where pa2.post_id = po.id and pa2.accepted)
  from content.series se
  join content.profiles o on o.id = se.owner_id
  join content.series_posts sp on sp.series_id = se.id and sp.accepted
  join content.posts po on po.id = sp.post_id
    and po.status = 'published' and po.visibility = 'public' and po.deleted_at is null
  join content.profiles pp on pp.id = po.author_id
  where o.handle = p_owner_handle and se.slug = p_series_slug and se.deleted_at is null
  order by sp.position;
$$;

-- ── one field (owner-scoped) ────────────────────────────────────────────────
create or replace function public.get_public_field(p_owner_handle text, p_field_slug text)
returns table (owner_handle citext, owner_name text, slug text, title text, summary text, mark text, series_count int)
language sql stable security definer set search_path = public, content, extensions as $$
  select o.handle, o.pen_name, f.slug, f.title, f.summary, f.mark,
    (select count(*)::int from content.field_series fs where fs.field_id = f.id and fs.accepted)
  from content.fields f
  join content.profiles o on o.id = f.owner_id
  where o.handle = p_owner_handle and f.slug = p_field_slug and f.deleted_at is null
    and (select count(*) from content.field_series fs where fs.field_id = f.id and fs.accepted) >= 2;
$$;

create or replace function public.list_field_series(p_owner_handle text, p_field_slug text)
returns table (
  pos int, series_owner_handle citext, series_slug text, series_title text, series_summary text,
  total int, published_count int, start_handle citext, start_slug text
)
language sql stable security definer set search_path = public, content, extensions as $$
  select fs.position, so.handle, se.slug, se.title, se.summary, se.total,
    (select count(*)::int from content.series_posts sp
       join content.posts po on po.id = sp.post_id
       where sp.series_id = se.id and sp.accepted
         and po.status = 'published' and po.visibility = 'public' and po.deleted_at is null),
    st.handle, st.slug
  from content.fields f
  join content.profiles o on o.id = f.owner_id
  join content.field_series fs on fs.field_id = f.id and fs.accepted
  join content.series se on se.id = fs.series_id and se.deleted_at is null
  join content.profiles so on so.id = se.owner_id
  -- "start here" = the first accepted published part (its own canonical handle + slug)
  left join lateral (
    select pp.handle, po.slug
    from content.series_posts sp
    join content.posts po on po.id = sp.post_id
      and po.status = 'published' and po.visibility = 'public' and po.deleted_at is null
    join content.profiles pp on pp.id = po.author_id
    where sp.series_id = se.id and sp.accepted
    order by sp.position
    limit 1
  ) st on true
  where o.handle = p_owner_handle and f.slug = p_field_slug and f.deleted_at is null
  order by fs.position;
$$;

-- ── data fix: self-memberships are auto-accepted (an author's own post in their own
--    series, their own series in their own field — no consent needed). Idempotent. ──────
update content.series_posts sp set accepted = true
  from content.series se, content.posts po
  where sp.series_id = se.id and sp.post_id = po.id and po.author_id = se.owner_id and not sp.accepted;
update content.field_series fs set accepted = true
  from content.fields f, content.series se
  where fs.field_id = f.id and fs.series_id = se.id and se.owner_id = f.owner_id and not fs.accepted;

-- ── grants (public read API) ────────────────────────────────────────────────
grant execute on function public.get_public_post(text, text)              to anon, authenticated;
grant execute on function public.get_public_author(text)                  to anon, authenticated;
grant execute on function public.list_author_posts_multi(text, int)       to anon, authenticated;
grant execute on function public.get_public_series(text, text)            to anon, authenticated;
grant execute on function public.list_series_posts(text, text)            to anon, authenticated;
grant execute on function public.get_public_field(text, text)             to anon, authenticated;
grant execute on function public.list_field_series(text, text)            to anon, authenticated;

-- VERIFY (optional):
--   select post_id, primary_handle, authors, series_slug, field_slug from public.get_public_post('shivam','feature-test');
--   select * from public.get_public_author('shivam');
