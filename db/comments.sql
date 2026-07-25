-- =============================================================================
-- db/comments.sql — Blog post comments: schema + Row-Level Security policies
-- =============================================================================
--
-- WHAT THIS FILE IS
--   A one-shot, idempotent migration script. Paste it into the Supabase SQL
--   editor (or run via psql against the Supabase Postgres) exactly once to
--   provision the `public.comments` table, turn on Row-Level Security (RLS),
--   and install the access policies + supporting index. It is safe to re-run:
--   every DDL statement uses `if not exists` or `create policy`/`create table`
--   guards where possible. (NOTE: `create policy` itself is NOT idempotent —
--   re-running against a DB that already has the policies will error on the
--   first policy. See "GOTCHAS" below.)
--
-- SINGLE RESPONSIBILITY
--   Own the storage + authorization model for user-authored comments on posts.
--   Nothing else. It defines *who can do what* to comment rows; it does not
--   render, validate at the app layer, or moderate.
--
-- HOW IT FITS THE ARCHITECTURE
--   This is a static Astro blog on Cloudflare Pages. There is no traditional
--   application server mediating the database — the browser talks to Supabase
--   directly via the Supabase JS client (PostgREST over HTTPS) using the public
--   `anon` key. That means the ONLY thing standing between an anonymous browser
--   and this table is Postgres RLS. The policies below ARE the security
--   boundary. If RLS were disabled or a policy were too permissive, any visitor
--   could read/write/delete arbitrarily. Treat every policy here as
--   security-critical code, not boilerplate.
--
--   Trust chain: Supabase Auth issues a signed JWT (email magic-link or GitHub
--   OAuth). The JS client attaches it to each PostgREST request. Postgres
--   exposes the authenticated user's id via `auth.uid()` (reads the `sub` claim
--   of the verified JWT). Policies compare `auth.uid()` to row columns to scope
--   access. `auth.uid()` returns NULL for signed-out ("anon") requests.
--
-- DEPENDS ON (must already exist)
--   - Supabase Auth schema: `auth.users` (FK target) and the `auth.uid()`
--     helper function. Provisioned automatically by Supabase; not created here.
--   - `gen_random_uuid()` — from pgcrypto/pgcrypto-provided builtin, available
--     by default on Supabase.
--
-- DEPENDED ON BY
--   - The client-side comments UI (Astro component + Supabase JS calls) that
--     lists, inserts, and deletes rows. It relies on `post_id` being the post
--     slug/identifier and on these exact policy semantics (public read,
--     self-only insert/delete). Column names here are the client's contract.
--   - `author_name` is denormalized onto the row so the UI can render a display
--     name without a join back into `auth.users` (which RLS/`anon` cannot read).
--
-- SECURITY ASSUMPTIONS / RLS RELIANCE
--   - RLS is the sole gate. `enable row level security` MUST stay on. With RLS
--     enabled and NO policy matching an operation, that operation is DENIED by
--     default — a fail-safe (e.g. there is no UPDATE policy, so updates/edits
--     are impossible for everyone via the anon/authenticated roles).
--   - The `service_role` key bypasses RLS entirely. It must NEVER ship to the
--     browser; it belongs only in server-side Pages Functions / admin tooling.
--   - Insert integrity: the `with check (auth.uid() = user_id)` clause stops a
--     signed-in user from forging comments as someone else — they can only
--     write rows whose `user_id` equals their own verified JWT subject.
--   - `author_name` is NOT verified against the JWT here; a malicious signed-in
--     client could set an arbitrary display name. If display-name spoofing
--     matters, enforce it in a trigger or a Pages Function, not in this file.
--
-- GOTCHAS
--   - Re-running the whole file on an already-provisioned DB errors at the
--     first `create policy` (policies lack `if not exists` in this Postgres
--     version). Drop the policies first, or run statements selectively.
--   - `on delete cascade` on the user FK means deleting an auth user auto-purges
--     all their comments — intended cleanup, but irreversible.
-- =============================================================================

-- Comments on blog posts. Run once in the Supabase SQL editor.

create table if not exists public.comments (
  -- Surrogate PK. Server-generated UUID so clients never pick their own id
  -- (prevents collisions and id-guessing); default fires on insert.
  id          uuid primary key default gen_random_uuid(),
  -- The post this comment belongs to — the post slug/identifier (text, not a
  -- FK) because posts live as static Markdown at build time, not in Postgres.
  post_id     text not null,
  -- Author's auth identity. FK into Supabase Auth. `on delete cascade`: when an
  -- auth user is deleted, all their comments are auto-removed (GDPR-friendly
  -- cleanup, but irreversible). This column is cross-checked by the insert RLS
  -- policy against auth.uid() so a user cannot post as someone else.
  user_id     uuid not null references auth.users(id) on delete cascade,
  -- Denormalized display name so the public/anon read path can render an author
  -- label without querying auth.users (which anon cannot read). NOTE: not
  -- verified against the JWT here — spoofable by a signed-in client.
  author_name text not null,
  -- Comment text. CHECK enforces 1..4000 chars at the DB level — a hard
  -- backstop independent of any client-side validation (which can be bypassed),
  -- rejecting empty and abusively long bodies.
  body        text not null check (char_length(body) between 1 and 4000),
  -- Server-set creation timestamp (default now()); also the sort key (see idx).
  created_at  timestamptz not null default now()
);

-- CRITICAL: turn on Row-Level Security. Without this line the table is wide
-- open to the anon key. Once enabled, every access must be permitted by an
-- explicit policy below; anything not covered is denied by default (fail-safe).
alter table public.comments enable row level security;

-- READ: fully public. `using (true)` = no row is filtered out, so even
-- signed-out (anon) visitors can list all comments. Intentional: comments are
-- meant to be publicly visible under posts. There is no per-row privacy here.
create policy "comments are public" on public.comments
  for select using (true);

-- INSERT: a signed-in user may create a comment ONLY as themselves. The
-- `with check` runs on the NEW row: it forces user_id to equal auth.uid() (the
-- verified JWT subject), blocking impersonation. Anon requests have
-- auth.uid() = NULL, so `NULL = user_id` is never true — anonymous inserts are
-- rejected. (Note: this does not constrain author_name; see table comment.)
create policy "users insert own comments" on public.comments
  for insert with check (auth.uid() = user_id);

-- DELETE: a user may remove only their OWN comments — `using` filters the
-- delete to rows where the owner matches the caller. No admin/moderator delete
-- policy exists here, so moderation must go through the service_role (which
-- bypasses RLS) in server-side tooling, not the browser.
-- Also note: there is deliberately NO update policy anywhere, so comment edits
-- are impossible for anon/authenticated roles (default-deny fail-safe).
create policy "users delete own comments" on public.comments
  for delete using (auth.uid() = user_id);

-- Composite index matching the read pattern: fetch a single post's comments in
-- chronological order. Covers the (post_id) equality filter plus (created_at)
-- ordering in one index, avoiding a sort at query time.
create index if not exists comments_post_id_idx on public.comments (post_id, created_at);
