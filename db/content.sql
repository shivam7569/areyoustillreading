-- =============================================================================
-- db/content.sql — Phase 1 of the multi-author rearchitecture: the `content`
-- schema (profiles, posts, series, fields + ordered join tables), its roles,
-- Row-Level Security, column-level grants, and the owner-only / write RPCs.
-- -----------------------------------------------------------------------------
-- WHAT THIS IS
--   The DB-authoritative model that content moves into (today content lives in
--   Markdown files). In Phase 1 NOTHING reads these tables — the live site still
--   serves from the static build + KV overlay. This file only stands the schema
--   up and locks it down; scripts/backfill-content.mjs shadow-loads the existing
--   posts/series/fields into it, and scripts/verify-content-bytediff.mjs proves
--   nothing rendered differently.
--
-- SECURITY SPINE (reused, unchanged): public.admins + public.is_admin()
--   (db/highlights.sql) is the SOLE super-admin/owner boundary. Authors are
--   ordinary users whose power is only "own your own rows" via RLS. The
--   revoke-from-anon+authenticated + grant-to-service_role lockdown for the
--   owner/write RPCs follows db/admins-manage.sql exactly.
--
-- IDEMPOTENT: run the whole file once in the Supabase SQL editor; safe to re-run
--   (schema/tables/indexes use `if not exists`, enums are DO-block guarded,
--   functions are create-or-replace, policies + triggers are drop-then-create).
--   The final DO block SELF-VERIFIES the privilege lockdown and RAISEs on drift.
--
-- SHADOW POSTURE: `content` is deliberately NOT added to Supabase's PostgREST
--   "Exposed schemas" list in Phase 1. All backfill/owner writes go through the
--   service-role key. Exposure to the browser is a Phase 2 step, only AFTER the
--   server-side ownership re-checks in the publish path exist.
-- =============================================================================

create schema if not exists content;
create extension if not exists citext;   -- case-insensitive @handle uniqueness

-- ── Enums (CREATE TYPE has no IF NOT EXISTS → guard each) ─────────────────────
do $$ begin create type content.user_role       as enum ('reader','author','editor');            exception when duplicate_object then null; end $$;
do $$ begin create type content.account_status   as enum ('active','suspended');                   exception when duplicate_object then null; end $$;
do $$ begin create type content.post_status      as enum ('draft','scheduled','published','archived'); exception when duplicate_object then null; end $$;
do $$ begin create type content.post_visibility  as enum ('public','unlisted','private');           exception when duplicate_object then null; end $$;
do $$ begin create type content.series_state     as enum ('in-progress','complete','paused');       exception when duplicate_object then null; end $$;

-- ── Helper / guard functions ─────────────────────────────────────────────────
-- Generic updated_at bump.
create or replace function content.touch_updated_at() returns trigger
  language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

-- Slugify a display string the same way the JS side does (lowercase, hyphenate).
create or replace function content.slugify(p text) returns text
  language sql immutable as $$
  select trim(both '-' from regexp_replace(lower(coalesce(p,'')), '[^a-z0-9]+', '-', 'g'));
$$;

-- Is this user allowed to author? RLS predicate (SECURITY DEFINER so a signed-in
-- caller can evaluate it without SELECT on content.profiles), same shape as
-- public.is_admin(). plpgsql (not sql) so its body — which references the
-- content.profiles table created further down — is validated at first CALL, not
-- at CREATE (a `language sql` body is planned at creation and would 42P01 here).
-- Pinned search_path is the required escalation defense.
create or replace function content.is_active_author(p_uid uuid) returns boolean
  language plpgsql stable security definer set search_path = content, public, extensions as $$
begin
  return exists (
    select 1 from content.profiles
    where id = p_uid and role in ('author','editor') and status = 'active' and deleted_at is null
  );
end $$;

-- Owner check for the SERVICE-ROLE RPCs below, which are handed a caller id.
-- NOTE: public.is_admin() is NULLARY and derives auth.uid() — useless under the
-- service-role key (auth.uid() is null), so those RPCs MUST use this instead.
create or replace function content.is_owner(p_caller uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = p_caller);
$$;

-- ── profiles — one row per participant (reader by default; author on invite) ──
create table if not exists content.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  handle      citext unique,                              -- @handle namespace (the pen name); null until provisioned
  pen_name    text        not null default '',
  role        content.user_role     not null default 'reader',
  status      content.account_status not null default 'active',
  can_publish boolean     not null default false,
  bio         text        not null default '',
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
alter table content.profiles enable row level security;
alter table content.profiles drop constraint if exists profiles_handle_shape;
alter table content.profiles add  constraint profiles_handle_shape
  check (handle is null or lower(handle::text) ~ '^[a-z0-9](?:[a-z0-9_-]{0,28}[a-z0-9])?$');

-- ── posts — draft + published, every frontmatter field mapped ────────────────
create table if not exists content.posts (
  id              uuid primary key default gen_random_uuid(),
  author_id       uuid not null references auth.users(id) on delete restrict,  -- no silent content loss
  slug            text not null,
  title           text not null default '',
  description     text not null default '',
  pub_date        timestamptz,                    -- pubDate
  updated_date    timestamptz,                    -- updatedDate
  publish_at      timestamptz,                    -- publishAt (scheduled)
  tags            text[] not null default '{}',
  author_byline   text not null default '',       -- frontmatter `author` (pen-name string)
  gateable        boolean not null default false, -- kept for the body-serving seam (monetization is out of scope)
  preview         text not null default '',
  status          content.post_status     not null default 'draft',
  visibility      content.post_visibility not null default 'public',
  -- two-slot body + reserved
  body_md         text not null default '',       -- DRAFT source (author-writable via RLS)
  body_html       text,                           -- PUBLISHED, rendered, inert (SERVER-ONLY)
  body_text       text,                           -- HTML-stripped plaintext for FTS (SERVER-ONLY)
  body_doc        jsonb,                          -- reserved (future typed-tree editor)
  reading_min     int,
  current_version int not null default 0,         -- bumped on publish; the KV pointer mirrors it (Phase 2)
  published_md    text,                           -- frozen source that produced body_html
  published_at    timestamptz,
  -- backfill provenance (lets the byte-diff gate prove losslessness)
  source_raw      text,                           -- the exact original .md file, byte-for-byte
  source_path     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);
alter table content.posts enable row level security;
create unique index if not exists posts_author_slug_uq on content.posts (author_id, slug) where deleted_at is null;
create index if not exists posts_status_pubdate_idx on content.posts (status, pub_date desc);
create index if not exists posts_author_idx          on content.posts (author_id);

-- ── series / fields — the collection metadata (owned, one author each) ───────
create table if not exists content.series (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users(id) on delete restrict,
  slug       text not null,
  title      text not null default '',
  summary    text not null default '',
  total      int,
  status     content.series_state,     -- null = auto (derived from parts)
  planned    text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
alter table content.series enable row level security;
create unique index if not exists series_owner_slug_uq on content.series (owner_id, slug) where deleted_at is null;

create table if not exists content.fields (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users(id) on delete restrict,
  slug       text not null,
  title      text not null default '',
  summary    text not null default '',
  mark       text not null default '01' check (mark ~ '^(0[1-9]|10)$'),  -- the 10 generative marks
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
alter table content.fields enable row level security;
create unique index if not exists fields_owner_slug_uq on content.fields (owner_id, slug) where deleted_at is null;

-- ── ordered join tables (red-team #4: RLS + same-author trigger on BOTH) ─────
create table if not exists content.series_posts (
  series_id  uuid not null references content.series(id) on delete cascade,
  post_id    uuid not null references content.posts(id)  on delete cascade,
  position   int  not null default 0,   -- = seriesOrder
  created_at timestamptz not null default now(),
  primary key (series_id, post_id)
);
alter table content.series_posts enable row level security;
create index if not exists series_posts_order_idx on content.series_posts (series_id, position);

create table if not exists content.field_series (
  field_id   uuid not null references content.fields(id)  on delete cascade,
  series_id  uuid not null references content.series(id)  on delete cascade,
  position   int  not null default 0,
  note       text not null default '',
  created_at timestamptz not null default now(),
  primary key (field_id, series_id)
);
alter table content.field_series enable row level security;
create index if not exists field_series_order_idx on content.field_series (field_id, position);

-- ── reserved handles (a handle can never shadow a route) ─────────────────────
create table if not exists content.reserved_handles (name citext primary key);
alter table content.reserved_handles enable row level security;   -- deny-all to clients; read only via SECURITY DEFINER
insert into content.reserved_handles (name) values
  ('admin'),('api'),('blog'),('series'),('s'),('fields'),('f'),('field'),('about'),
  ('login'),('logout'),('signup'),('signin'),('account'),('settings'),('resume'),('projects'),
  ('rss'),('sitemap'),('og'),('gated'),('search'),('tags'),('tag'),('_astro'),('assets'),
  ('fonts'),('build-meta'),('post-shell'),('usercontent'),('sandbox'),('cell-runner'),
  ('www'),('root'),('owner'),('staff'),('support'),('help'),('null'),('undefined')
on conflict (name) do nothing;

-- Return a unique, non-reserved handle from a base string (append -2/-3 on collision).
create or replace function content.unique_handle(p_base text) returns citext
  language plpgsql security definer set search_path = content, public, extensions as $$
declare v_base text; v_try text; v_i int := 1;
begin
  v_base := nullif(content.slugify(p_base), '');
  if v_base is null then v_base := 'author'; end if;
  v_base := left(v_base, 28);
  v_try  := v_base;
  while exists (select 1 from content.reserved_handles r where r.name = v_try::citext)
     or exists (select 1 from content.profiles p        where p.handle = v_try::citext) loop
    v_i := v_i + 1;
    v_try := left(v_base, 26) || '-' || v_i;
  end loop;
  return v_try::citext;
end $$;

-- ── updated_at triggers ──────────────────────────────────────────────────────
drop trigger if exists profiles_touch on content.profiles;
create trigger profiles_touch before update on content.profiles for each row execute function content.touch_updated_at();
drop trigger if exists posts_touch on content.posts;
create trigger posts_touch before update on content.posts for each row execute function content.touch_updated_at();
drop trigger if exists series_touch on content.series;
create trigger series_touch before update on content.series for each row execute function content.touch_updated_at();
drop trigger if exists fields_touch on content.fields;
create trigger fields_touch before update on content.fields for each row execute function content.touch_updated_at();

-- ── same-author enforcement on the join tables (defense in depth beyond RLS) ─
create or replace function content.enforce_same_author_series_posts() returns trigger
  language plpgsql security definer set search_path = content, public, extensions as $$
declare v_series_owner uuid; v_post_author uuid;
begin
  select owner_id  into v_series_owner from content.series where id = new.series_id;
  select author_id into v_post_author  from content.posts  where id = new.post_id;
  if v_series_owner is null or v_post_author is null or v_series_owner <> v_post_author then
    raise exception 'series_posts: series (%) and post (%) must share one owner', new.series_id, new.post_id;
  end if;
  return new;
end $$;
drop trigger if exists series_posts_same_author on content.series_posts;
create trigger series_posts_same_author before insert or update on content.series_posts
  for each row execute function content.enforce_same_author_series_posts();

create or replace function content.enforce_same_author_field_series() returns trigger
  language plpgsql security definer set search_path = content, public, extensions as $$
declare v_field_owner uuid; v_series_owner uuid;
begin
  select owner_id into v_field_owner  from content.fields where id = new.field_id;
  select owner_id into v_series_owner from content.series where id = new.series_id;
  if v_field_owner is null or v_series_owner is null or v_field_owner <> v_series_owner then
    raise exception 'field_series: field (%) and series (%) must share one owner', new.field_id, new.series_id;
  end if;
  return new;
end $$;
drop trigger if exists field_series_same_author on content.field_series;
create trigger field_series_same_author before insert or update on content.field_series
  for each row execute function content.enforce_same_author_field_series();

-- ── RLS policies ─────────────────────────────────────────────────────────────
-- profiles: a user sees/edits ONLY their own row; owner sees/edits any. There is
-- no client INSERT/DELETE (profiles are created by the owner-only RPC). Public
-- author info (handle/pen_name) is exposed later via a controlled RPC projection,
-- never by a broad SELECT here.
drop policy if exists profiles_select on content.profiles;
create policy profiles_select on content.profiles for select using (id = auth.uid() or public.is_admin());
drop policy if exists profiles_update_own on content.profiles;
create policy profiles_update_own on content.profiles for update using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());

-- posts: author sees own (non-deleted) + owner sees all. Public reads go through
-- the service-role read RPC (Phase 2), NOT this policy — bodies stay unreadable
-- over PostgREST. Authors INSERT/UPDATE their own; only the owner hard-DELETEs.
drop policy if exists posts_select on content.posts;
create policy posts_select on content.posts for select using ((author_id = auth.uid() and deleted_at is null) or public.is_admin());
drop policy if exists posts_insert_own on content.posts;
create policy posts_insert_own on content.posts for insert with check (author_id = auth.uid() and content.is_active_author(auth.uid()));
drop policy if exists posts_update_own on content.posts;
create policy posts_update_own on content.posts for update using (author_id = auth.uid() or public.is_admin()) with check (author_id = auth.uid() or public.is_admin());
drop policy if exists posts_delete_admin on content.posts;
create policy posts_delete_admin on content.posts for delete using (public.is_admin());

-- series / fields: own-or-admin select, insert-own (active author), update-own, admin-delete.
drop policy if exists series_select on content.series;
create policy series_select on content.series for select using ((owner_id = auth.uid() and deleted_at is null) or public.is_admin());
drop policy if exists series_insert_own on content.series;
create policy series_insert_own on content.series for insert with check (owner_id = auth.uid() and content.is_active_author(auth.uid()));
drop policy if exists series_update_own on content.series;
create policy series_update_own on content.series for update using (owner_id = auth.uid() or public.is_admin()) with check (owner_id = auth.uid() or public.is_admin());
drop policy if exists series_delete_admin on content.series;
create policy series_delete_admin on content.series for delete using (public.is_admin());

drop policy if exists fields_select on content.fields;
create policy fields_select on content.fields for select using ((owner_id = auth.uid() and deleted_at is null) or public.is_admin());
drop policy if exists fields_insert_own on content.fields;
create policy fields_insert_own on content.fields for insert with check (owner_id = auth.uid() and content.is_active_author(auth.uid()));
drop policy if exists fields_update_own on content.fields;
create policy fields_update_own on content.fields for update using (owner_id = auth.uid() or public.is_admin()) with check (owner_id = auth.uid() or public.is_admin());
drop policy if exists fields_delete_admin on content.fields;
create policy fields_delete_admin on content.fields for delete using (public.is_admin());

-- join tables (red-team #4): gated by owning BOTH parent rows; owner may moderate.
drop policy if exists series_posts_select on content.series_posts;
create policy series_posts_select on content.series_posts for select using (
  public.is_admin() or exists (select 1 from content.series s where s.id = series_id and s.owner_id = auth.uid())
);
drop policy if exists series_posts_insert on content.series_posts;
create policy series_posts_insert on content.series_posts for insert with check (
  exists (select 1 from content.series s where s.id = series_id and s.owner_id = auth.uid())
  and exists (select 1 from content.posts p where p.id = post_id and p.author_id = auth.uid())
);
drop policy if exists series_posts_update on content.series_posts;
create policy series_posts_update on content.series_posts for update using (
  public.is_admin() or exists (select 1 from content.series s where s.id = series_id and s.owner_id = auth.uid())
) with check (
  public.is_admin() or exists (select 1 from content.series s where s.id = series_id and s.owner_id = auth.uid())
);
drop policy if exists series_posts_delete on content.series_posts;
create policy series_posts_delete on content.series_posts for delete using (
  public.is_admin() or exists (select 1 from content.series s where s.id = series_id and s.owner_id = auth.uid())
);

drop policy if exists field_series_select on content.field_series;
create policy field_series_select on content.field_series for select using (
  public.is_admin() or exists (select 1 from content.fields f where f.id = field_id and f.owner_id = auth.uid())
);
drop policy if exists field_series_insert on content.field_series;
create policy field_series_insert on content.field_series for insert with check (
  exists (select 1 from content.fields f  where f.id = field_id  and f.owner_id = auth.uid())
  and exists (select 1 from content.series s where s.id = series_id and s.owner_id = auth.uid())
);
drop policy if exists field_series_update on content.field_series;
create policy field_series_update on content.field_series for update using (
  public.is_admin() or exists (select 1 from content.fields f where f.id = field_id and f.owner_id = auth.uid())
) with check (
  public.is_admin() or exists (select 1 from content.fields f where f.id = field_id and f.owner_id = auth.uid())
);
drop policy if exists field_series_delete on content.field_series;
create policy field_series_delete on content.field_series for delete using (
  public.is_admin() or exists (select 1 from content.fields f where f.id = field_id and f.owner_id = auth.uid())
);

-- ── owner-only lifecycle RPCs (service-role locked; the ONLY writers of the
--    privilege columns handle/role/status/can_publish — red-team #2) ──────────
create or replace function content.provision_profile(
  p_caller uuid, p_user_id uuid, p_pen_name text, p_handle text default null,
  p_role content.user_role default 'author', p_can_publish boolean default true)
returns content.profiles language plpgsql security definer set search_path = content, public, extensions as $$
declare v_row content.profiles; v_handle citext;
begin
  if not content.is_owner(p_caller) then raise exception 'not authorized'; end if;
  v_handle := content.unique_handle(coalesce(nullif(content.slugify(p_handle), ''), p_pen_name));
  insert into content.profiles (id, handle, pen_name, role, can_publish, status)
    values (p_user_id, v_handle, coalesce(p_pen_name, ''), p_role, coalesce(p_can_publish, true), 'active')
  on conflict (id) do update
    set pen_name = excluded.pen_name, role = excluded.role, can_publish = excluded.can_publish, status = 'active', updated_at = now()
  returning * into v_row;
  return v_row;
end $$;

create or replace function content.set_profile_role(p_caller uuid, p_user_id uuid, p_role content.user_role)
returns void language plpgsql security definer set search_path = content, public, extensions as $$
begin
  if not content.is_owner(p_caller) then raise exception 'not authorized'; end if;
  update content.profiles set role = p_role, updated_at = now() where id = p_user_id;
end $$;

create or replace function content.set_profile_status(p_caller uuid, p_user_id uuid, p_status content.account_status)
returns void language plpgsql security definer set search_path = content, public, extensions as $$
begin
  if not content.is_owner(p_caller) then raise exception 'not authorized'; end if;
  update content.profiles set status = p_status, updated_at = now() where id = p_user_id;
end $$;

create or replace function content.set_can_publish(p_caller uuid, p_user_id uuid, p_value boolean)
returns void language plpgsql security definer set search_path = content, public, extensions as $$
begin
  if not content.is_owner(p_caller) then raise exception 'not authorized'; end if;
  update content.profiles set can_publish = coalesce(p_value, false), updated_at = now() where id = p_user_id;
end $$;

create or replace function content.claim_handle(p_caller uuid, p_user_id uuid, p_handle text)
returns citext language plpgsql security definer set search_path = content, public, extensions as $$
declare v_handle citext;
begin
  if not content.is_owner(p_caller) then raise exception 'not authorized'; end if;
  v_handle := content.unique_handle(p_handle);
  update content.profiles set handle = v_handle, updated_at = now() where id = p_user_id;
  return v_handle;
end $$;

-- ── write RPCs (service-role; the publish trust boundary, ownership re-checked
--    in code so a caller can never publish another author's post — red-team
--    #1/#3 write side). Rendering happens in the caller (Node/Function) which
--    passes the already-sanitized body_html; this RPC only commits state. ──────
create or replace function content.publish_post(
  p_caller uuid, p_post_id uuid, p_body_html text, p_body_text text, p_reading_min int default null)
returns content.posts language plpgsql security definer set search_path = content, public, extensions as $$
declare v_row content.posts;
begin
  select * into v_row from content.posts where id = p_post_id and deleted_at is null;
  if not found then raise exception 'post not found'; end if;
  if v_row.author_id <> p_caller and not content.is_owner(p_caller) then
    raise exception 'not authorized to publish this post';
  end if;
  -- Publishing requires an active author with can_publish; the owner may always publish.
  if not content.is_owner(p_caller)
     and not exists (select 1 from content.profiles
                     where id = v_row.author_id and can_publish and status = 'active' and deleted_at is null) then
    raise exception 'author not permitted to publish';
  end if;
  update content.posts set
    body_html = p_body_html, body_text = p_body_text,
    reading_min = coalesce(p_reading_min, reading_min),
    published_md = body_md, status = 'published', published_at = now(),
    current_version = current_version + 1, updated_at = now()
  where id = p_post_id returning * into v_row;
  return v_row;
end $$;

create or replace function content.unpublish_post(p_caller uuid, p_post_id uuid, p_op text default 'unpublish')
returns content.posts language plpgsql security definer set search_path = content, public, extensions as $$
declare v_row content.posts;
begin
  select * into v_row from content.posts where id = p_post_id;
  if not found then raise exception 'post not found'; end if;
  if v_row.author_id <> p_caller and not content.is_owner(p_caller) then
    raise exception 'not authorized';
  end if;
  update content.posts set
    status = case when p_op = 'archive' then 'archived'::content.post_status
                  when p_op = 'delete'  then status else 'draft'::content.post_status end,
    visibility = case when p_op = 'unlist' then 'unlisted'::content.post_visibility else visibility end,
    deleted_at = case when p_op = 'delete' then now() else deleted_at end,
    current_version = current_version + 1, updated_at = now()
  where id = p_post_id returning * into v_row;
  return v_row;
end $$;

-- =============================================================================
-- LOCKDOWN + GRANTS. Order matters: Supabase auto-grants EVERYTHING to anon +
-- authenticated at object-creation time, so REVOKE first, then grant narrowly.
-- (Same footgun documented in db/admins-manage.sql.)
-- =============================================================================
revoke all on all tables    in schema content from anon, authenticated;
revoke all on all functions in schema content from anon, authenticated;
alter default privileges in schema content revoke all on tables    from anon, authenticated;
alter default privileges in schema content revoke all on functions from anon, authenticated;

grant usage on schema content to authenticated, service_role;

-- RLS-predicate helper is callable by signed-in (and anon) callers, like is_admin().
grant execute on function content.is_active_author(uuid) to authenticated, anon;

-- profiles: read own row (RLS-gated), edit ONLY cosmetic columns of it.
grant select on content.profiles to authenticated;
grant update (pen_name, bio, avatar_url) on content.profiles to authenticated;

-- posts: read own (RLS-gated); write ONLY author-editable columns. Everything
-- lifecycle/rendered (status, body_html, body_text, visibility, current_version,
-- published_*, author_id) is EXCLUDED → set only by the service-role write RPCs.
grant select on content.posts to authenticated;
grant insert (author_id, slug, title, description, pub_date, updated_date, publish_at, tags, author_byline, gateable, preview, body_md) on content.posts to authenticated;
grant update (slug, title, description, pub_date, updated_date, publish_at, tags, author_byline, gateable, preview, body_md, deleted_at) on content.posts to authenticated;

-- series / fields: read own (RLS-gated); write own columns (never owner_id on update).
grant select on content.series to authenticated;
grant insert (owner_id, slug, title, summary, total, status, planned) on content.series to authenticated;
grant update (slug, title, summary, total, status, planned, deleted_at)  on content.series to authenticated;
grant select on content.fields to authenticated;
grant insert (owner_id, slug, title, summary, mark) on content.fields to authenticated;
grant update (slug, title, summary, mark, deleted_at) on content.fields to authenticated;

-- join tables: RLS gates the rows; the row-level grant is coarse.
grant select, insert, update, delete on content.series_posts to authenticated;
grant select, insert, update, delete on content.field_series to authenticated;

-- Owner/write RPCs: SERVICE-ROLE ONLY. Revoke from the concrete PostgREST roles
-- (not just public) or a signed-in caller could invoke them straight through
-- /rest/v1/rpc and self-provision/publish. (db/admins-manage.sql pattern.)
revoke all on function content.is_owner(uuid)                                                                          from public, anon, authenticated;
revoke all on function content.unique_handle(text)                                                                     from public, anon, authenticated;
revoke all on function content.provision_profile(uuid,uuid,text,text,content.user_role,boolean)                        from public, anon, authenticated;
revoke all on function content.set_profile_role(uuid,uuid,content.user_role)                                           from public, anon, authenticated;
revoke all on function content.set_profile_status(uuid,uuid,content.account_status)                                    from public, anon, authenticated;
revoke all on function content.set_can_publish(uuid,uuid,boolean)                                                      from public, anon, authenticated;
revoke all on function content.claim_handle(uuid,uuid,text)                                                            from public, anon, authenticated;
revoke all on function content.publish_post(uuid,uuid,text,text,integer)                                               from public, anon, authenticated;
revoke all on function content.unpublish_post(uuid,uuid,text)                                                          from public, anon, authenticated;
grant execute on function content.is_owner(uuid)                                                                        to service_role;
grant execute on function content.unique_handle(text)                                                                   to service_role;
grant execute on function content.provision_profile(uuid,uuid,text,text,content.user_role,boolean)                      to service_role;
grant execute on function content.set_profile_role(uuid,uuid,content.user_role)                                         to service_role;
grant execute on function content.set_profile_status(uuid,uuid,content.account_status)                                  to service_role;
grant execute on function content.set_can_publish(uuid,uuid,boolean)                                                    to service_role;
grant execute on function content.claim_handle(uuid,uuid,text)                                                          to service_role;
grant execute on function content.publish_post(uuid,uuid,text,text,integer)                                            to service_role;
grant execute on function content.unpublish_post(uuid,uuid,text)                                                        to service_role;

-- =============================================================================
-- SELF-VERIFY: RAISE on any privilege drift so a re-run proves the lockdown.
-- =============================================================================
do $$
begin
  if has_column_privilege('authenticated','content.posts','body_html','update')      then raise exception 'VERIFY FAIL: authenticated can UPDATE posts.body_html'; end if;
  if has_column_privilege('authenticated','content.posts','status','update')         then raise exception 'VERIFY FAIL: authenticated can UPDATE posts.status'; end if;
  if has_column_privilege('authenticated','content.posts','body_text','update')      then raise exception 'VERIFY FAIL: authenticated can UPDATE posts.body_text'; end if;
  if has_column_privilege('authenticated','content.posts','current_version','update')then raise exception 'VERIFY FAIL: authenticated can UPDATE posts.current_version'; end if;
  if has_column_privilege('authenticated','content.posts','author_id','update')      then raise exception 'VERIFY FAIL: authenticated can UPDATE posts.author_id'; end if;
  if has_column_privilege('authenticated','content.profiles','role','update')        then raise exception 'VERIFY FAIL: authenticated can UPDATE profiles.role'; end if;
  if has_column_privilege('authenticated','content.profiles','status','update')      then raise exception 'VERIFY FAIL: authenticated can UPDATE profiles.status'; end if;
  if has_column_privilege('authenticated','content.profiles','can_publish','update') then raise exception 'VERIFY FAIL: authenticated can UPDATE profiles.can_publish'; end if;
  if has_column_privilege('authenticated','content.profiles','handle','update')      then raise exception 'VERIFY FAIL: authenticated can UPDATE profiles.handle'; end if;
  if has_function_privilege('authenticated','content.provision_profile(uuid,uuid,text,text,content.user_role,boolean)','execute') then raise exception 'VERIFY FAIL: authenticated can EXECUTE provision_profile'; end if;
  if has_function_privilege('anon','content.publish_post(uuid,uuid,text,text,integer)','execute') then raise exception 'VERIFY FAIL: anon can EXECUTE publish_post'; end if;
  if not (select relrowsecurity from pg_class where oid = 'content.series_posts'::regclass) then raise exception 'VERIFY FAIL: RLS off on series_posts'; end if;
  if not (select relrowsecurity from pg_class where oid = 'content.field_series'::regclass) then raise exception 'VERIFY FAIL: RLS off on field_series'; end if;
  if not (select relrowsecurity from pg_class where oid = 'content.posts'::regclass)        then raise exception 'VERIFY FAIL: RLS off on posts'; end if;
  perform content.unique_handle('lt-verify-citext');  -- exercises the citext search_path; fails LOUD here if misconfigured
  raise notice 'db/content.sql — VERIFY OK: privilege lockdown + RLS assertions all passed.';
end $$;
