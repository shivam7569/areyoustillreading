-- =============================================================================
-- db/content-collab.sql — collaboration: co-authored posts + cross-author series
-- and fields, gated by consent. Builds on db/content.sql. Idempotent.
-- -----------------------------------------------------------------------------
-- MODEL (owner-confirmed):
--   * A post has one or more EQUAL authors (content.post_authors). All ACCEPTED
--     authors edit the post and appear on the byline; the position-0 author is the
--     creator / monogram lead. A co-author is INVITED and must ACCEPT.
--   * A series/field keeps a single CURATOR (owner_id), but its members can be
--     other people's posts/series — each membership stays PENDING until the member's
--     owner ACCEPTS (accepted=false → true). The old same-author triggers are dropped.
--   * Every cross-party mutation goes through a public-schema SECURITY DEFINER RPC
--     that verifies the caller (auth.uid()) in code — NOT through client write-RLS.
--     Direct client writes to the membership tables are revoked; reads stay RLS-gated.
--
-- SECURITY: these public RPCs are granted to `authenticated` and run as definer, so
--   the in-code permission check IS the boundary — mirrors db/admins-manage.sql. Each
--   checks auth.uid() against ownership/authorship before writing. anon gets nothing.
-- =============================================================================

-- ── content.post_authors — the full author set of a post ─────────────────────
create table if not exists content.post_authors (
  post_id    uuid not null references content.posts(id) on delete cascade,
  user_id    uuid not null references auth.users(id)   on delete cascade,
  position   int  not null default 0,          -- 0 = primary/creator (byline lead, monogram)
  accepted   boolean not null default false,   -- primary is auto-accepted; co-authors accept an invite
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
alter table content.post_authors enable row level security;
create index if not exists post_authors_user_idx on content.post_authors (user_id, accepted);

-- Is p_uid an ACCEPTED author of p_post? (edit + byline predicate.)
create or replace function content.is_post_author(p_post uuid, p_uid uuid) returns boolean
  language plpgsql stable security definer set search_path = content, public, extensions as $$
begin
  return exists (select 1 from content.post_authors pa
                 where pa.post_id = p_post and pa.user_id = p_uid and pa.accepted);
end $$;

-- Seed the creator's position-0, accepted author row on EVERY new post, so an author
-- is never locked out of a post they just created (posts_select/update key off
-- is_post_author). SECURITY DEFINER because the client role has no write grant on
-- post_authors. Fires for client inserts, service-role inserts, and the backfill.
create or replace function content.seed_primary_author() returns trigger
  language plpgsql security definer set search_path = content, public, extensions as $$
begin
  insert into content.post_authors (post_id, user_id, position, accepted, invited_by)
  values (new.id, new.author_id, 0, true, new.author_id)
  on conflict (post_id, user_id) do nothing;
  return new;
end $$;
drop trigger if exists posts_seed_author on content.posts;
create trigger posts_seed_author after insert on content.posts
  for each row execute function content.seed_primary_author();

-- ── posts: edit/select rights now come from post_authors, not a single author_id ─
-- (author_id stays as the denormalized PRIMARY author — creator + monogram lead.)
drop policy if exists posts_select on content.posts;
create policy posts_select on content.posts for select using (
  (content.is_post_author(id, auth.uid()) and deleted_at is null) or public.is_admin()
);
drop policy if exists posts_update_own on content.posts;
create policy posts_update_own on content.posts for update
  using (content.is_post_author(id, auth.uid()) or public.is_admin())
  with check (content.is_post_author(id, auth.uid()) or public.is_admin());
-- insert policy unchanged: author_id = auth.uid() AND is_active_author (creator owns row 0).

-- ── membership tables gain consent state ─────────────────────────────────────
alter table content.series_posts add column if not exists accepted   boolean not null default false;
alter table content.series_posts add column if not exists invited_by uuid references auth.users(id) on delete set null;
alter table content.field_series add column if not exists accepted   boolean not null default false;
alter table content.field_series add column if not exists invited_by uuid references auth.users(id) on delete set null;

-- Cross-author is now allowed (gated by consent in the RPCs) → retire the same-author guards.
drop trigger  if exists series_posts_same_author on content.series_posts;
drop trigger  if exists field_series_same_author on content.field_series;
drop function if exists content.enforce_same_author_series_posts();
drop function if exists content.enforce_same_author_field_series();

-- ── lock down direct client writes to memberships; the RPCs own them ─────────
revoke all    on content.post_authors from anon, authenticated;   -- new table; lock it, then re-grant select only
revoke insert, update, delete on content.series_posts from authenticated;
revoke insert, update, delete on content.field_series from authenticated;
grant  select on content.post_authors to authenticated;   -- see your own memberships/invites (RLS-gated)

-- The Phase-1 direct-write policies on the membership tables are now moot (grants
-- revoked; the SECURITY DEFINER RPCs own all writes). Drop them so the intent is clear.
drop policy if exists series_posts_insert on content.series_posts;
drop policy if exists series_posts_update on content.series_posts;
drop policy if exists series_posts_delete on content.series_posts;
drop policy if exists field_series_insert on content.field_series;
drop policy if exists field_series_update on content.field_series;
drop policy if exists field_series_delete on content.field_series;

-- post_authors reads: your own row, a post you co-author, or admin.
drop policy if exists post_authors_select on content.post_authors;
create policy post_authors_select on content.post_authors for select using (
  user_id = auth.uid() or content.is_post_author(post_id, auth.uid()) or public.is_admin()
);

-- =============================================================================
-- MUTATION RPCs (public schema so authors can call them; SECURITY DEFINER; the
-- in-code auth.uid() checks ARE the boundary). All revoke anon, grant authenticated.
-- =============================================================================

-- Co-authors ------------------------------------------------------------------
create or replace function public.invite_coauthor(p_post uuid, p_invitee uuid)
returns void language plpgsql security definer set search_path = content, public, extensions as $$
begin
  if not content.is_post_author(p_post, auth.uid()) then raise exception 'not an author of this post'; end if;
  if not content.is_active_author(p_invitee) then raise exception 'invitee is not an author'; end if;
  insert into content.post_authors (post_id, user_id, position, accepted, invited_by)
    values (p_post, p_invitee,
            coalesce((select max(position) from content.post_authors where post_id = p_post), 0) + 1,
            false, auth.uid())
  on conflict (post_id, user_id) do nothing;
end $$;

create or replace function public.respond_coauthor(p_post uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = content, public, extensions as $$
begin
  if p_accept then
    update content.post_authors set accepted = true where post_id = p_post and user_id = auth.uid();
  else
    delete from content.post_authors where post_id = p_post and user_id = auth.uid() and accepted = false;
  end if;
end $$;

create or replace function public.remove_coauthor(p_post uuid, p_user uuid)
returns void language plpgsql security definer set search_path = content, public, extensions as $$
declare v_primary uuid;
begin
  select author_id into v_primary from content.posts where id = p_post;
  if v_primary = p_user then raise exception 'cannot remove the primary author'; end if;
  -- self-leave, or the primary author removes a collaborator, or admin
  if auth.uid() <> p_user and auth.uid() <> v_primary and not content.is_owner(auth.uid()) then
    raise exception 'not authorized to remove this author';
  end if;
  delete from content.post_authors where post_id = p_post and user_id = p_user;
end $$;

-- Series membership (cross-author, consent-gated) -----------------------------
create or replace function public.add_series_post(p_series uuid, p_post uuid, p_position int default 0)
returns void language plpgsql security definer set search_path = content, public, extensions as $$
declare v_owner uuid; v_auto boolean;
begin
  select owner_id into v_owner from content.series where id = p_series and deleted_at is null;
  if v_owner is null or v_owner <> auth.uid() then raise exception 'not the series curator'; end if;
  if not exists (select 1 from content.posts where id = p_post and deleted_at is null) then raise exception 'no such post'; end if;
  v_auto := content.is_post_author(p_post, auth.uid());   -- curating your OWN post → auto-accepted
  insert into content.series_posts (series_id, post_id, position, accepted, invited_by)
    values (p_series, p_post, coalesce(p_position, 0), v_auto, auth.uid())
  on conflict (series_id, post_id) do update set position = excluded.position;
end $$;

create or replace function public.respond_series_post(p_series uuid, p_post uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = content, public, extensions as $$
begin
  if not content.is_post_author(p_post, auth.uid()) then raise exception 'not an author of this post'; end if;
  if p_accept then
    update content.series_posts set accepted = true where series_id = p_series and post_id = p_post;
  else
    delete from content.series_posts where series_id = p_series and post_id = p_post;
  end if;
end $$;

create or replace function public.remove_series_post(p_series uuid, p_post uuid)
returns void language plpgsql security definer set search_path = content, public, extensions as $$
declare v_owner uuid;
begin
  select owner_id into v_owner from content.series where id = p_series;
  -- the series curator can remove any member; a post's author can withdraw their post
  if auth.uid() <> v_owner and not content.is_post_author(p_post, auth.uid()) and not content.is_owner(auth.uid()) then
    raise exception 'not authorized';
  end if;
  delete from content.series_posts where series_id = p_series and post_id = p_post;
end $$;

-- Field membership (cross-owner series, consent-gated) ------------------------
create or replace function public.add_field_series(p_field uuid, p_series uuid, p_position int default 0)
returns void language plpgsql security definer set search_path = content, public, extensions as $$
declare v_fowner uuid; v_sowner uuid;
begin
  select owner_id into v_fowner from content.fields where id = p_field and deleted_at is null;
  if v_fowner is null or v_fowner <> auth.uid() then raise exception 'not the field curator'; end if;
  select owner_id into v_sowner from content.series where id = p_series and deleted_at is null;
  if v_sowner is null then raise exception 'no such series'; end if;
  insert into content.field_series (field_id, series_id, position, accepted, invited_by)
    values (p_field, p_series, coalesce(p_position, 0), v_sowner = auth.uid(), auth.uid())
  on conflict (field_id, series_id) do update set position = excluded.position;
end $$;

create or replace function public.respond_field_series(p_field uuid, p_series uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = content, public, extensions as $$
declare v_sowner uuid;
begin
  select owner_id into v_sowner from content.series where id = p_series;
  if v_sowner <> auth.uid() then raise exception 'not the series owner'; end if;
  if p_accept then
    update content.field_series set accepted = true where field_id = p_field and series_id = p_series;
  else
    delete from content.field_series where field_id = p_field and series_id = p_series;
  end if;
end $$;

create or replace function public.remove_field_series(p_field uuid, p_series uuid)
returns void language plpgsql security definer set search_path = content, public, extensions as $$
declare v_fowner uuid; v_sowner uuid;
begin
  select owner_id into v_fowner from content.fields where id = p_field;
  select owner_id into v_sowner from content.series where id = p_series;
  if auth.uid() <> v_fowner and auth.uid() <> v_sowner and not content.is_owner(auth.uid()) then
    raise exception 'not authorized';
  end if;
  delete from content.field_series where field_id = p_field and series_id = p_series;
end $$;

-- My pending invites (an inbox): co-author + series + field, for the signed-in caller.
create or replace function public.my_collab_invites()
returns table (kind text, post_id uuid, series_id uuid, field_id uuid, title text, invited_by uuid)
language sql stable security definer set search_path = content, public, extensions as $$
  select 'coauthor', pa.post_id, null::uuid, null::uuid, po.title, pa.invited_by
    from content.post_authors pa join content.posts po on po.id = pa.post_id
    where pa.user_id = auth.uid() and pa.accepted = false
  union all
  select 'series-post', sp.post_id, sp.series_id, null::uuid, po.title, sp.invited_by
    from content.series_posts sp join content.posts po on po.id = sp.post_id
    where sp.accepted = false and content.is_post_author(sp.post_id, auth.uid())
  union all
  select 'field-series', null::uuid, fs.series_id, fs.field_id, se.title, fs.invited_by
    from content.field_series fs join content.series se on se.id = fs.series_id
    where fs.accepted = false and se.owner_id = auth.uid();
$$;

-- Grants: authenticated may call; anon never.
do $$
declare fn text;
begin
  foreach fn in array array[
    'public.invite_coauthor(uuid,uuid)', 'public.respond_coauthor(uuid,boolean)', 'public.remove_coauthor(uuid,uuid)',
    'public.add_series_post(uuid,uuid,integer)', 'public.respond_series_post(uuid,uuid,boolean)', 'public.remove_series_post(uuid,uuid)',
    'public.add_field_series(uuid,uuid,integer)', 'public.respond_field_series(uuid,uuid,boolean)', 'public.remove_field_series(uuid,uuid)',
    'public.my_collab_invites()'
  ] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;
grant execute on function content.is_post_author(uuid, uuid) to authenticated, anon;

-- ── BACKFILL: existing content becomes single-author, fully accepted ─────────
insert into content.post_authors (post_id, user_id, position, accepted)
  select id, author_id, 0, true from content.posts
on conflict (post_id, user_id) do nothing;
update content.series_posts set accepted = true where accepted = false;   -- all pre-collab rows are the curator's own
update content.field_series set accepted = true where accepted = false;

-- ── SELF-VERIFY ───────────────────────────────────────────────────────────────
do $$
begin
  if has_function_privilege('anon', 'public.invite_coauthor(uuid,uuid)', 'execute') then raise exception 'VERIFY FAIL: anon can invite_coauthor'; end if;
  if has_table_privilege('authenticated', 'content.series_posts', 'insert') then raise exception 'VERIFY FAIL: authenticated can INSERT series_posts directly'; end if;
  if has_table_privilege('authenticated', 'content.post_authors', 'insert') then raise exception 'VERIFY FAIL: authenticated can INSERT post_authors directly'; end if;
  if not (select relrowsecurity from pg_class where oid = 'content.post_authors'::regclass) then raise exception 'VERIFY FAIL: RLS off on post_authors'; end if;
  raise notice 'db/content-collab.sql — VERIFY OK: co-author + consent model in place, direct membership writes locked.';
end $$;
