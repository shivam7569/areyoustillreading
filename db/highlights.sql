-- =============================================================================
-- db/highlights.sql — Reader "highlights" + per-highlight reader↔admin thread.
-- =============================================================================
--
-- WHAT THIS FILE IS
--   The complete Postgres schema for the "highlights" feature of
--   areyoustillreading.dev: a signed-in reader can highlight a quote from a
--   blog post, and a private 1:1 discussion thread hangs off each highlight
--   between that reader and the site owner (admin). It is a hand-run migration,
--   NOT part of the Astro build — you paste it into the Supabase SQL editor.
--
-- SINGLE RESPONSIBILITY
--   Define three tables (admins, highlights, highlight_comments), the
--   is_admin() helper, and the Row-Level Security (RLS) policies that are the
--   ONLY thing standing between one reader and every other reader's private
--   quotes/notes. This file owns the data model + its authorization rules.
--
-- HOW IT FITS THE ARCHITECTURE
--   - Supabase Postgres is reached over PostgREST directly from the browser
--     using the Supabase JS client and the ANON key. There is no trusted
--     server layer in front of these tables for this feature, so EVERY access
--     rule must live in RLS here. auth.uid() is the caller's authenticated
--     user id (from the Supabase JWT); it is NULL for anonymous requests, so
--     an unauthenticated caller matches no row-owner predicate and sees/writes
--     nothing.
--   - Auth is Supabase (email magic-link + GitHub OAuth). Rows key off
--     auth.users(id).
--   - "Admin" (the site owner) is identified by membership in public.admins,
--     surfaced through the is_admin() SQL function used across the project.
--
-- DEPENDS ON (upstream)
--   - Supabase auth schema: auth.users(id) and the auth.uid() function.
--   - pgcrypto / gen_random_uuid() for default primary keys (available by
--     default on Supabase).
--
-- DEPENDED ON BY (downstream)
--   - The browser-side highlights UI (Supabase JS client) reads/writes
--     public.highlights and public.highlight_comments.
--   - is_admin() and the public.admins table are shared with the rest of the
--     project (e.g. the payments/paywall admin bypass); do not narrow them
--     without checking other callers.
--
-- SECURITY MODEL / ASSUMPTIONS (read before changing anything)
--   - RLS is the whole security boundary. If RLS is ever disabled on these
--     tables, the browser ANON key can read/write EVERYONE's rows. Every table
--     below explicitly runs `enable row level security`.
--   - is_admin() is SECURITY DEFINER with a pinned search_path. That lets a
--     normal reader call it to evaluate a policy even though they have no
--     select privilege on public.admins (there is deliberately no select
--     policy on admins). Pinning search_path = public is the standard defense
--     against search_path-hijack privilege escalation on SECURITY DEFINER
--     functions — do not remove it.
--   - The client sends user_id / author_name itself, so insert policies must
--     force auth.uid() = user_id (a reader cannot forge a row as someone else).
--     author_name is cosmetic and NOT trusted for authorization.
--   - NO UPDATE policy exists on ANY table below (only select/insert/delete).
--     Because RLS default-denies anything not covered by a policy, this makes
--     highlights and comments effectively IMMUTABLE over the ANON key: rows can
--     be created and deleted but never edited (an UPDATE silently affects zero
--     rows). This is intentional — the UI has no edit affordance. If you ever
--     add editing, you must add an explicit `for update` policy with BOTH a
--     using and a with check clause, or the update will appear to no-op.
--
-- OPERATIONAL NOTE
--   Run once in the Supabase SQL editor. Written to be idempotent (safe to
--   re-run): tables use `if not exists`, policies are dropped-then-created, and
--   is_admin() uses `create or replace`.

-- 1) Admins (the site owner). After signing in once, find your user id in
--    Supabase → Authentication → Users, then run:
--       insert into public.admins (user_id) values ('<your-user-uuid>');
-- WHY a table (not a hardcoded uuid / JWT claim): membership is data, so the
-- owner can be changed without a redeploy, and other features (paywall bypass)
-- reuse it. on delete cascade: if the auth user is deleted, admin rights vanish
-- automatically — no dangling admin pointing at a nonexistent account.
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.admins enable row level security;
-- No select policy is defined ON PURPOSE. With RLS enabled and zero policies,
-- normal callers can read NOTHING from this table directly — so a reader can
-- never enumerate who the admin is. Membership is only ever tested indirectly
-- through is_admin(), which runs as SECURITY DEFINER and bypasses this lockout.
-- (Admin rows are inserted by the owner via the Supabase editor / service role,
-- which is exempt from RLS.)

-- is_admin(): "is the current caller the site owner?" Used as a predicate in
-- the RLS policies further down. SECURITY DEFINER so it executes with the
-- function owner's privileges and can read public.admins even though the
-- calling reader has no select access to it. STABLE: result is fixed within a
-- single statement, letting the planner cache it. set search_path = public is a
-- REQUIRED hardening step on SECURITY DEFINER functions — without a pinned
-- search_path a caller could shadow `admins` with an object in their own schema
-- and trick the function into returning true (privilege escalation). Do not
-- remove it. Returns false (not null) for anonymous callers because auth.uid()
-- is null and matches no row.
create or replace function public.is_admin() returns boolean
  language plpgsql stable security definer set search_path = public as $$
begin
  return exists (select 1 from public.admins where user_id = auth.uid());
end;
$$;

-- 2) Highlights — a reader sees their own; the admin sees everyone's.
create table if not exists public.highlights (
  id          uuid primary key default gen_random_uuid(),
  post_id     text not null,                    -- slug/id of the blog post; text (not FK) because posts are static Astro content, not DB rows
  user_id     uuid not null references auth.users(id) on delete cascade,  -- owner; on delete cascade removes a reader's highlights when their account is deleted
  author_name text not null default 'Reader',   -- display-only label; NOT trusted for authz (see file header)
  quote       text not null check (char_length(quote) between 1 and 2000),-- length guard: reject empty and cap size to bound abuse/storage
  created_at  timestamptz not null default now()
);
-- Backfill for older deployments created before author_name existed. Idempotent
-- and harmless on a fresh install where the column already exists.
alter table public.highlights add column if not exists author_name text not null default 'Reader';
alter table public.highlights enable row level security;

-- Drop-then-create every policy so re-running this file always converges to the
-- exact policy set below (CREATE POLICY has no "or replace"). The first three
-- drops are for the OLD policy names from an earlier schema version — kept so a
-- re-run cleanly retires them and no stale, over-permissive policy lingers.
drop policy if exists "users read own highlights" on public.highlights;
drop policy if exists "users insert own highlights" on public.highlights;
drop policy if exists "users delete own highlights" on public.highlights;
drop policy if exists "hl read own or admin" on public.highlights;
drop policy if exists "hl insert own" on public.highlights;
drop policy if exists "hl delete own or admin" on public.highlights;
-- SELECT: a reader sees only their own rows; the admin sees everyone's. This is
-- the core privacy boundary — without it the ANON key would expose all readers'
-- highlights to each other.
create policy "hl read own or admin" on public.highlights
  for select using (auth.uid() = user_id or public.is_admin());
-- INSERT: with check forces the new row's user_id to equal the caller — a
-- reader cannot plant a highlight under someone else's identity. No admin
-- branch here on purpose: the admin has no reason to author highlights as a
-- reader, and allowing it would let admin-owned rows masquerade as a reader's.
create policy "hl insert own" on public.highlights
  for insert with check (auth.uid() = user_id);
-- DELETE: owner can remove their own; admin can moderate/remove any.
create policy "hl delete own or admin" on public.highlights
  for delete using (auth.uid() = user_id or public.is_admin());
-- Index matches the hot query "this reader's highlights on this post"
-- (post_id, user_id) and keeps RLS predicate lookups cheap.
create index if not exists highlights_post_user_idx on public.highlights (post_id, user_id);

-- 3) Discussion on a highlight — visible only to that highlight's reader + admin.
--    This is a private 1:1 thread: the reader who owns the highlight and the
--    admin. There is deliberately no notion of a public comment.
create table if not exists public.highlight_comments (
  id           uuid primary key default gen_random_uuid(),
  highlight_id uuid not null references public.highlights(id) on delete cascade,  -- parent thread; cascade removes comments when the highlight is deleted
  user_id      uuid not null references auth.users(id) on delete cascade,         -- comment author (reader or admin)
  author_name  text not null,                                                     -- display-only label; NOT trusted for authz
  body         text not null check (char_length(body) between 1 and 4000),        -- length guard: non-empty, capped
  created_at   timestamptz not null default now()
);
alter table public.highlight_comments enable row level security;

-- Drop-then-create for idempotent convergence (see the highlights section).
drop policy if exists "hc read" on public.highlight_comments;
drop policy if exists "hc insert" on public.highlight_comments;
drop policy if exists "hc delete" on public.highlight_comments;
-- SELECT: visible to the admin, OR to the reader who owns the PARENT highlight.
-- Note the check is against highlights.user_id (thread owner), NOT the comment's
-- own user_id — so the reader sees the admin's replies in their own thread, and
-- a reader can never read comments on a highlight that isn't theirs.
create policy "hc read" on public.highlight_comments for select using (
  public.is_admin()
  or exists (select 1 from public.highlights h where h.id = highlight_id and h.user_id = auth.uid())
);
-- INSERT: two independent guards must both hold.
--   1) auth.uid() = user_id — you can only post AS yourself (no forging author).
--   2) you are the admin OR you own the parent highlight — you can only post
--      INTO a thread you are a party to. Without guard 2 any reader could append
--      comments to a stranger's private thread even though guard 1 passed.
create policy "hc insert" on public.highlight_comments for insert with check (
  auth.uid() = user_id
  and (
    public.is_admin()
    or exists (select 1 from public.highlights h where h.id = highlight_id and h.user_id = auth.uid())
  )
);
-- DELETE: an author may delete their own comment; the admin may delete any
-- (moderation). A reader canNOT delete the admin's replies in their thread —
-- ownership is checked on the comment's own user_id here, not the thread's.
create policy "hc delete" on public.highlight_comments for delete using (
  auth.uid() = user_id or public.is_admin()
);
-- Index matches the hot query "all comments for this highlight, oldest first"
-- (highlight_id, created_at) — powers thread rendering and the RLS subquery.
create index if not exists highlight_comments_hid_idx on public.highlight_comments (highlight_id, created_at);
