-- =============================================================================
-- db/drafts.sql — durable per-user editor drafts (the new-post scratchpad).
-- =============================================================================
-- WHAT THIS IS
--   One draft row per user: the admin editor's new-post autosave, kept in the DB
--   so a draft survives a browser-data clear or a switch to another device —
--   previously it lived only in localStorage. Editing an existing post does NOT
--   use this table (those edits commit on Publish); only the new-post scratchpad.
--
-- HOW TO APPLY
--   Run ONCE by hand in the Supabase SQL editor. Until it exists the editor just
--   falls back to its localStorage draft (all writes are best-effort).
--
-- SECURITY
--   RLS ON. A user can read/write ONLY their own draft (auth.uid() = user_id).
--   The editor talks to this table directly with the browser's Supabase client
--   (like highlights/notes) — no service-role key involved.
-- =============================================================================

create table if not exists public.drafts (
  -- One draft per user. PK = user_id makes the editor's upsert (on_conflict) trivial.
  user_id    uuid primary key references auth.users(id) on delete cascade,
  -- The in-progress Markdown (frontmatter is added at publish time, not stored here).
  content    text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.drafts enable row level security;

-- Own-row access for every operation. auth.uid() is the JWT subject, so a caller
-- can only ever touch their own draft — no cross-user read/write.
drop policy if exists "drafts own" on public.drafts;
create policy "drafts own" on public.drafts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
