-- Private per-reader notes (one per post per reader).
-- Requires public.is_admin() from db/highlights.sql. Run once in the SQL editor.

create table if not exists public.notes (
  id          uuid primary key default gen_random_uuid(),
  post_id     text not null,
  user_id     uuid not null references auth.users(id) on delete cascade,
  author_name text not null default 'Reader',
  body        text not null check (char_length(body) <= 8000),
  updated_at  timestamptz not null default now(),
  unique (post_id, user_id)
);

alter table public.notes enable row level security;

drop policy if exists "notes read own or admin" on public.notes;
drop policy if exists "notes insert own" on public.notes;
drop policy if exists "notes update own" on public.notes;
drop policy if exists "notes delete own or admin" on public.notes;

create policy "notes read own or admin" on public.notes
  for select using (auth.uid() = user_id or public.is_admin());
create policy "notes insert own" on public.notes
  for insert with check (auth.uid() = user_id);
create policy "notes update own" on public.notes
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "notes delete own or admin" on public.notes
  for delete using (auth.uid() = user_id or public.is_admin());

create index if not exists notes_post_user_idx on public.notes (post_id, user_id);
