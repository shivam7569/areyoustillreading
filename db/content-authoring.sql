-- =============================================================================
-- db/content-authoring.sql — the AUTHOR write API (Phase 3, DB authoring).
-- Wires the dormant content.* authoring machinery to the app. Everything the app
-- calls lives in the PUBLIC schema (the only schemas PostgREST exposes are public +
-- graphql_public; content.* stays unexposed) — matching the reader serve RPCs.
--
--   public.author_save_post  — create/update an author's OWN draft. service-role ONLY
--                              (called by /api/author/post behind requireAuthor);
--                              ownership enforced in-RPC since the service-role
--                              bypasses RLS. Sets only author-editable columns.
--   public.author_publish    — wraps content.publish_post (commits the rendered,
--                              inert-guarded body_html); returns slug + @handle.
--   public.author_unpublish  — wraps content.unpublish_post (draft/archive/unlist/del).
--   public.my_profile        — the caller's own profile (role/handle → role-scoped
--                              Studio signal + onboarding state). authenticated.
--   public.my_posts          — the caller's own posts (drafts + published). authenticated.
--   public.claim_my_handle   — self-service ONE-TIME @handle claim (onboarding).
--   public.update_my_profile — self-service pen_name/bio/avatar edit.
--
-- The privileged columns (body_html/status/published_*) stay writable ONLY through
-- content.publish_post. Rendering + sanitize happen in the caller (the browser render
-- pipeline); the publish endpoint adds an inert-guard backstop (lib/inert-guard.js).
-- Idempotent. Apply AFTER db/content.sql + db/content-collab.sql (ADDS objects only —
-- never touches the collab-superseded policies).
-- Apply:  node --env-file=.env scripts/apply-sql.mjs db/content-authoring.sql
-- =============================================================================

-- A stray earlier revision lived in the content schema (unreachable via PostgREST); drop it.
drop function if exists content.save_post(uuid,uuid,text,text,text,text[],text,jsonb,timestamptz,timestamptz,boolean,text,text);

-- ── save a draft (create or update the caller's own post) ────────────────────
create or replace function public.author_save_post(
  p_caller uuid, p_post_id uuid,
  p_slug text, p_title text, p_description text, p_tags text[],
  p_body_md text, p_body_doc jsonb default null,
  p_pub_date timestamptz default null, p_publish_at timestamptz default null,
  p_gateable boolean default false, p_preview text default '', p_author_byline text default '')
returns uuid language plpgsql security definer set search_path = public, content, extensions as $$
declare v_id uuid;
begin
  if not (content.is_active_author(p_caller) or content.is_owner(p_caller)) then
    raise exception 'not an active author';
  end if;
  if coalesce(nullif(btrim(p_slug), ''), '') = '' then raise exception 'slug required'; end if;

  -- Resolve the target post: an explicit id, else the caller's OWN existing post with this slug
  -- (edit-by-slug — the single publish path has no post_id when re-opening/editing an existing
  -- post, so this makes save idempotent instead of colliding on the per-author unique slug), else new.
  if p_post_id is not null then
    v_id := p_post_id;
  else
    select id into v_id from content.posts where author_id = p_caller and slug = p_slug and deleted_at is null;
  end if;

  if v_id is null then
    -- NEW post: author_id = caller; the seed_primary_author trigger records the creator
    -- as position-0 accepted author. slug is unique per author (posts_author_slug_uq).
    insert into content.posts (author_id, slug, title, description, tags, body_md, body_doc,
        pub_date, publish_at, gateable, preview, author_byline)
      values (p_caller, p_slug, coalesce(p_title, ''), coalesce(p_description, ''),
        coalesce(p_tags, '{}'), coalesce(p_body_md, ''), p_body_doc,
        p_pub_date, p_publish_at, coalesce(p_gateable, false),
        coalesce(p_preview, ''), coalesce(p_author_byline, ''))
      returning id into v_id;
  else
    if not exists (select 1 from content.posts where id = v_id and deleted_at is null) then
      raise exception 'post not found';
    end if;
    if not (content.is_post_author(v_id, p_caller) or content.is_owner(p_caller)) then
      raise exception 'not authorized to edit this post';
    end if;
    update content.posts set
      slug = p_slug, title = coalesce(p_title, ''), description = coalesce(p_description, ''),
      tags = coalesce(p_tags, '{}'), body_md = coalesce(p_body_md, ''),
      body_doc = coalesce(p_body_doc, body_doc),
      pub_date = coalesce(p_pub_date, pub_date), publish_at = coalesce(p_publish_at, publish_at),
      gateable = coalesce(p_gateable, gateable),
      preview = coalesce(p_preview, preview),
      author_byline = coalesce(p_author_byline, author_byline),
      updated_at = now()
    where id = v_id;
  end if;
  return v_id;
end $$;

-- ── publish / unpublish (wrap the content.* trust-boundary RPCs; return the
--    canonical slug + @handle so the endpoint can hand back /@handle/slug) ─────
create or replace function public.author_publish(
  p_caller uuid, p_post_id uuid, p_body_html text, p_body_text text, p_reading_min int default null)
returns table (slug text, handle citext, status text)
language plpgsql security definer set search_path = public, content, extensions as $$
declare v_row content.posts;
begin
  v_row := content.publish_post(p_caller, p_post_id, p_body_html, p_body_text, p_reading_min);
  return query select v_row.slug, pr.handle, v_row.status::text
    from content.profiles pr where pr.id = v_row.author_id;
end $$;

create or replace function public.author_unpublish(p_caller uuid, p_post_id uuid, p_op text default 'unpublish')
returns table (slug text, handle citext, status text)
language plpgsql security definer set search_path = public, content, extensions as $$
declare v_row content.posts;
begin
  v_row := content.unpublish_post(p_caller, p_post_id, p_op);
  return query select v_row.slug, pr.handle, v_row.status::text
    from content.profiles pr where pr.id = v_row.author_id;
end $$;

-- ── the caller's own profile (role signal + onboarding state) ────────────────
create or replace function public.my_profile()
returns table (handle citext, pen_name text, role content.user_role, status content.account_status,
  can_publish boolean, bio text, avatar_url text)
language sql stable security definer set search_path = public, content, extensions as $$
  select p.handle, p.pen_name, p.role, p.status, p.can_publish, p.bio, p.avatar_url
  from content.profiles p
  where p.id = auth.uid() and p.deleted_at is null;
$$;

-- ── the caller's own posts (drafts + published) for the Studio lists ─────────
create or replace function public.my_posts()
returns table (
  id uuid, slug text, title text, description text, tags text[],
  status content.post_status, visibility content.post_visibility,
  pub_date timestamptz, publish_at timestamptz, reading_min int, gateable boolean,
  updated_at timestamptz, published_at timestamptz, primary_handle citext, is_owner_post boolean)
language sql stable security definer set search_path = public, content, extensions as $$
  select po.id, po.slug, po.title, po.description, po.tags, po.status, po.visibility,
    po.pub_date, po.publish_at, po.reading_min, po.gateable, po.updated_at, po.published_at,
    pp.handle, (po.author_id = auth.uid())
  from content.posts po
  join content.profiles pp on pp.id = po.author_id
  where content.is_post_author(po.id, auth.uid()) and po.deleted_at is null
  order by po.updated_at desc;
$$;

-- ── self-service ONE-TIME @handle claim (onboarding) ─────────────────────────
-- Distinct, clear errors (invalid/reserved/taken) so the UI can react. Only claims
-- when no handle is set yet; changing an existing handle stays owner-mediated.
create or replace function public.claim_my_handle(p_handle text)
returns citext language plpgsql security definer set search_path = public, content, extensions as $$
declare v_uid uuid := auth.uid(); v_h text; v_norm citext;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if not content.is_active_author(v_uid) then raise exception 'not an author'; end if;
  if exists (select 1 from content.profiles where id = v_uid and handle is not null) then
    raise exception 'handle already set';
  end if;
  v_h := lower(btrim(coalesce(p_handle, '')));
  if v_h !~ '^[a-z0-9](?:[a-z0-9_-]{0,28}[a-z0-9])?$' then raise exception 'invalid handle'; end if;
  v_norm := v_h::citext;
  if exists (select 1 from content.reserved_handles where name = v_norm) then raise exception 'handle reserved'; end if;
  if exists (select 1 from content.profiles where handle = v_norm) then raise exception 'handle taken'; end if;
  update content.profiles set handle = v_norm, updated_at = now() where id = v_uid;
  return v_norm;
end $$;

-- ── self-service profile edit (pen name / bio / avatar) ──────────────────────
create or replace function public.update_my_profile(p_pen_name text, p_bio text default null, p_avatar_url text default null)
returns void language plpgsql security definer set search_path = public, content, extensions as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if not exists (select 1 from content.profiles where id = v_uid and deleted_at is null) then
    raise exception 'no profile';
  end if;
  update content.profiles set
    pen_name   = coalesce(nullif(btrim(p_pen_name), ''), pen_name),
    bio        = coalesce(p_bio, bio),
    avatar_url = coalesce(nullif(btrim(p_avatar_url), ''), avatar_url),
    updated_at = now()
  where id = v_uid;
end $$;

-- ── set the pen name (display byline) ONLY — the @handle is PERMANENT ─────────
-- The @handle is claimed once at onboarding (claim_my_handle) and never changes, so a reader's
-- links to an author never break. The pen name is just the display/byline name and can change
-- freely WITHOUT moving anyone's /@handle URL. Returns the (unchanged) handle so callers can show
-- it. No-op-safe for readers (no profile) — the caller ignores the 'no author profile' error.
create or replace function public.set_my_pen_name(p_pen_name text)
returns table (handle citext, pen_name text)
language plpgsql security definer set search_path = public, content, extensions as $$
declare v_uid uuid := auth.uid(); v_name text; v_handle citext;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  v_name := btrim(coalesce(p_pen_name, ''));
  if v_name = '' then raise exception 'pen name required'; end if;
  if not exists (select 1 from content.profiles where id = v_uid and deleted_at is null) then
    raise exception 'no author profile';
  end if;
  update content.profiles set pen_name = v_name, updated_at = now() where id = v_uid;
  select p.handle into v_handle from content.profiles p where p.id = v_uid;
  return query select v_handle, v_name;
end $$;

-- ── grants (least privilege) ─────────────────────────────────────────────────
-- Supabase auto-grants EXECUTE to public on creation, so REVOKE first. The author_*
-- write RPCs are the server-bridge → service_role ONLY (only the gated Function, which
-- passes a validated p_caller, may invoke them). The my_*/claim/update RPCs act on the
-- caller's own auth.uid() → authenticated (never anon).
revoke all on function public.author_save_post(uuid,uuid,text,text,text,text[],text,jsonb,timestamptz,timestamptz,boolean,text,text) from public, anon, authenticated;
revoke all on function public.author_publish(uuid,uuid,text,text,int)   from public, anon, authenticated;
revoke all on function public.author_unpublish(uuid,uuid,text)          from public, anon, authenticated;
grant execute on function public.author_save_post(uuid,uuid,text,text,text,text[],text,jsonb,timestamptz,timestamptz,boolean,text,text) to service_role;
grant execute on function public.author_publish(uuid,uuid,text,text,int)   to service_role;
grant execute on function public.author_unpublish(uuid,uuid,text)          to service_role;

revoke all on function public.my_profile()                     from public, anon;
revoke all on function public.my_posts()                       from public, anon;
revoke all on function public.claim_my_handle(text)            from public, anon;
revoke all on function public.update_my_profile(text,text,text) from public, anon;
revoke all on function public.set_my_pen_name(text)            from public, anon;
grant execute on function public.my_profile()                     to authenticated;
grant execute on function public.my_posts()                       to authenticated;
grant execute on function public.claim_my_handle(text)            to authenticated;
grant execute on function public.update_my_profile(text,text,text) to authenticated;
grant execute on function public.set_my_pen_name(text)            to authenticated;

-- Make the new/changed functions callable via PostgREST immediately (otherwise the
-- REST schema cache lags a DDL change and the first calls 404 with PGRST202).
notify pgrst, 'reload schema';

-- VERIFY (optional):
--   select public.author_save_post('<uid>'::uuid, null, 'db-hello', 'Hello', '', '{}', '# Hi');
--   select * from public.author_publish('<uid>'::uuid, '<post_id>'::uuid, '<p>Hi</p>', 'Hi', 1);
