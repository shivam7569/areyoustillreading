-- =============================================================================
-- db/drafts.sql — durable editor drafts (the new-post scratchpads).
-- =============================================================================
-- WHAT THIS IS
--   MANY draft rows per user: the admin editor's new-post autosave, kept in the DB
--   so drafts survive a browser-data clear or a switch to another device. Each
--   unpublished new post the author starts is its OWN draft (its own id), so
--   starting a new one never overwrites the last. Editing an EXISTING published
--   post does NOT use this table (those edits commit on Publish); only new-post
--   scratchpads live here.
--
-- HOW TO APPLY
--   Run ONCE by hand in the Supabase SQL editor. It is idempotent: the CREATE sets
--   up a fresh install; the ALTERs migrate an older single-draft table (whose
--   primary key was user_id) to the multi-draft shape. Until it exists the editor
--   just falls back to per-device localStorage (all DB writes are best-effort).
--
-- SECURITY
--   RLS ON. A user can read/write ONLY their own drafts (auth.uid() = user_id).
--   The editor talks to this table directly with the browser's Supabase client
--   (like highlights/notes) — no service-role key involved.
-- =============================================================================

-- Fresh installs get the multi-draft shape directly.
create table if not exists public.drafts (
  -- Each draft its own id, so one user can hold many in-progress drafts at once.
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  -- The in-progress Markdown (frontmatter is added at publish time, not stored here).
  content    text not null default '',
  -- A cheap label for the Drafts list (the doc's first heading), kept in sync on save.
  title      text not null default '',
  updated_at timestamptz not null default now()
);

-- Migrate an existing single-draft table (its PK was user_id) to multi-draft.
-- Safe to run repeatedly: the columns/constraints/index are all "if (not) exists".
alter table public.drafts add column if not exists id uuid not null default gen_random_uuid();
alter table public.drafts add column if not exists title text not null default '';
alter table public.drafts drop constraint if exists drafts_pkey;   -- old PK on user_id
alter table public.drafts add primary key (id);
-- List a user's drafts newest-first without a full scan.
create index if not exists drafts_user_updated_idx on public.drafts (user_id, updated_at desc);

alter table public.drafts enable row level security;

-- Own-row access for every operation. auth.uid() is the JWT subject, so a caller
-- can only ever touch their own drafts — no cross-user read/write.
drop policy if exists "drafts own" on public.drafts;
create policy "drafts own" on public.drafts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
