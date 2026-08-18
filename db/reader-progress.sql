-- ===========================================================================
-- reader_progress — per-reader, per-post reading position.
-- Powers "Continue" (field + series) and the read-marks in the arc / parts list /
-- series spine. The browser talks straight to Supabase (anon key + RLS), like
-- notes/highlights — there is no Pages Function in the path. Run once in the
-- Supabase SQL editor.
-- ===========================================================================
create table if not exists public.reader_progress (
  user_id    uuid        not null references auth.users(id) on delete cascade,
  post_slug  text        not null,
  pct        smallint    not null default 0 check (pct >= 0 and pct <= 100),
  read       boolean     not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, post_slug)
);

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
