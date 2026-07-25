-- =============================================================================
-- db/notes.sql — "Private per-reader notes" table + Row-Level Security policies
-- =============================================================================
--
-- WHAT THIS FILE IS
--   A one-shot, idempotent Supabase/Postgres migration script. Paste it into the
--   Supabase SQL editor (or run via psql) once to provision the `public.notes`
--   table, turn on Row-Level Security (RLS), and install the four access
--   policies + supporting index. Re-running it is safe: every statement is
--   guarded (`create table if not exists`, `drop policy if exists`,
--   `create index if not exists`).
--
-- SINGLE RESPONSIBILITY
--   Persist a private, free-text note that a signed-in reader keeps against a
--   given blog post — exactly ONE note per (post, reader) pair — and guarantee
--   at the database layer that a reader can only ever see/edit their own note
--   (with admins granted read+delete for moderation/cleanup, but NOT edit).
--
-- HOW IT FITS THE ARCHITECTURE
--   - Supabase exposes this table over PostgREST. The browser talks to it
--     directly via the Supabase JS client using the reader's authenticated
--     session (a JWT). There is NO trusted server-side layer in front of these
--     writes, so RLS below is the ONLY thing enforcing per-user isolation.
--     If RLS were disabled or the policies dropped, every reader could read and
--     overwrite every other reader's notes. Treat the policies as security-
--     critical, not cosmetic.
--   - `auth.users` is Supabase's built-in auth schema; `auth.uid()` returns the
--     UUID of the caller extracted from their JWT (NULL for anonymous requests).
--   - Sibling feature to db/highlights.sql (per-reader highlights); this file
--     deliberately reuses the same `public.is_admin()` helper defined there so
--     admin identity has a single source of truth.
--
-- DEPENDENCIES (what this file needs to already exist)
--   - Supabase `auth` schema (provides auth.users + auth.uid()).
--   - `gen_random_uuid()` — pgcrypto/pg extension, enabled by default on
--     Supabase.
--   - public.is_admin() — a SECURITY DEFINER SQL function created in
--     db/highlights.sql that returns true iff the caller's uid is in the
--     `admins` table. MUST be run BEFORE this file, or the policy creation on
--     lines below will fail with "function public.is_admin() does not exist".
--
-- WHAT DEPENDS ON THIS FILE
--   - The client-side notes UI (Astro components / Supabase JS calls) that lets
--     a reader read and autosave their note on a post page. It relies on the
--     unique(post_id, user_id) constraint to upsert (one row per post/reader).
--
-- SECURITY ASSUMPTIONS / GOTCHAS
--   - RLS is the whole security boundary here (see above). Do not add a
--     service-role code path that writes to this table without re-checking
--     ownership — the service role BYPASSES RLS entirely.
--   - post_id is an untrusted, free-form `text` (the post slug); there is no FK
--     to a posts table because posts live in the static Astro build, not the DB.
--     A note can therefore outlive/precede its post. That is intentional.
--   - author_name is a denormalized display convenience supplied by the client;
--     it is NOT an identity/authorization field — never trust it for access
--     decisions. auth.uid() = user_id is the only identity check that matters.
-- =============================================================================

-- Private per-reader notes (one per post per reader).
-- Requires public.is_admin() from db/highlights.sql. Run once in the SQL editor.

create table if not exists public.notes (
  -- Surrogate PK. Random UUID (not sequential) so ids are unguessable and leak
  -- no ordering/volume info; generated server-side so the client never sets it.
  id          uuid primary key default gen_random_uuid(),
  -- The post's slug/identifier from the static Astro build. Deliberately a
  -- plain `text` with NO foreign key: posts are compiled into the site, not
  -- stored in Postgres, so the DB cannot (and should not) validate this.
  post_id     text not null,
  -- Owner of the note. FK to Supabase auth.users; ON DELETE CASCADE means when
  -- a reader deletes their account, all their notes are auto-purged (GDPR-
  -- friendly, no orphan rows). This column is the sole identity anchor the RLS
  -- policies below compare against auth.uid().
  user_id     uuid not null references auth.users(id) on delete cascade,
  -- Display-only name shown in the UI. Client-supplied convenience, NOT an
  -- authorization field — see the header note. Defaults to 'Reader'.
  author_name text not null default 'Reader',
  -- The note text. CHECK caps length at 8000 chars as a cheap, DB-enforced
  -- guard against unbounded/abusive payloads even if a client skips validation.
  body        text not null check (char_length(body) <= 8000),
  -- Last-write timestamp. Defaults to now() on insert; the client is expected
  -- to set it on update (there is no trigger auto-bumping it here).
  updated_at  timestamptz not null default now(),
  -- Enforces the core "one note per post per reader" invariant at the DB level.
  -- Also the target the client relies on for upsert (INSERT ... ON CONFLICT).
  unique (post_id, user_id)
);

-- Turn on RLS. Without this line, the policies below would exist but be
-- unenforced and PostgREST would expose the whole table to every caller. This
-- is the switch that makes per-reader isolation real. Do not remove.
alter table public.notes enable row level security;

-- Drop-before-create makes this migration idempotent: re-running the file
-- replaces the policies cleanly instead of erroring on "policy already exists".
drop policy if exists "notes read own or admin" on public.notes;
drop policy if exists "notes insert own" on public.notes;
drop policy if exists "notes update own" on public.notes;
drop policy if exists "notes delete own or admin" on public.notes;

-- SELECT: a reader sees only their own notes; admins may read anyone's (for
-- moderation / support). `using` is the row-visibility filter applied to reads.
create policy "notes read own or admin" on public.notes
  for select using (auth.uid() = user_id or public.is_admin());

-- INSERT: `with check` runs against the NEW row. Requiring auth.uid() = user_id
-- stops a reader from forging a note owned by someone else. Note there is NO
-- admin bypass here — admins cannot author notes on a reader's behalf.
create policy "notes insert own" on public.notes
  for insert with check (auth.uid() = user_id);

-- UPDATE: both clauses required. `using` gates WHICH rows may be targeted (only
-- your own); `with check` re-validates the row AFTER the update so a reader
-- cannot rewrite user_id to hand the note to (or steal it from) another user.
-- Intentionally no admin path: admins can read/delete but must not edit a
-- reader's private words.
create policy "notes update own" on public.notes
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- DELETE: a reader may delete their own note; admins may delete anyone's, for
-- cleanup/moderation of abusive content.
create policy "notes delete own or admin" on public.notes
  for delete using (auth.uid() = user_id or public.is_admin());

-- Composite index on the exact (post_id, user_id) shape the app filters/upserts
-- by. Redundant-looking vs. the UNIQUE constraint above (which also creates an
-- index), but harmless and idempotent; keeps the lookup fast and intent explicit.
create index if not exists notes_post_user_idx on public.notes (post_id, user_id);
