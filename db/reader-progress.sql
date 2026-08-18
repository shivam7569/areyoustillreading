-- ===========================================================================
-- reader_progress — per-reader, per-post reading position (granular: subsection).
-- Powers "Continue" (resumes at the exact subsection) and the read-marks. The
-- browser talks straight to Supabase (anon key + RLS), like notes/highlights.
-- Idempotent — safe to re-run; the ALTERs add the subsection columns to an
-- existing table. Run in the Supabase SQL editor.
-- ===========================================================================
create table if not exists public.reader_progress (
  user_id    uuid        not null references auth.users(id) on delete cascade,
  post_slug  text        not null,
  pct        smallint    not null default 0 check (pct >= 0 and pct <= 100),
  read       boolean     not null default false,
  anchor     text        not null default '',   -- id of the furthest heading reached (deep-link target)
  heading    text        not null default '',   -- that heading's text (for the "Continue from …" label)
  updated_at timestamptz not null default now(),
  primary key (user_id, post_slug)
);

-- Bring an existing (v1) table up to date.
alter table public.reader_progress add column if not exists anchor  text not null default '';
alter table public.reader_progress add column if not exists heading text not null default '';

alter table public.reader_progress enable row level security;

-- A reader may see and write ONLY their own rows.
drop policy if exists reader_progress_select_own on public.reader_progress;
create policy reader_progress_select_own on public.reader_progress
  for select using (auth.uid() = user_id);

drop policy if exists reader_progress_insert_own on public.reader_progress;
create policy reader_progress_insert_own on public.reader_progress
  for insert with check (auth.uid() = user_id);

drop policy if exists reader_progress_update_own on public.reader_progress;
create policy reader_progress_update_own on public.reader_progress
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update on public.reader_progress to authenticated;
