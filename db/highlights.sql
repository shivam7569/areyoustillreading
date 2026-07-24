-- Private per-reader highlights. Run once in the Supabase SQL editor.

create table if not exists public.highlights (
  id         uuid primary key default gen_random_uuid(),
  post_id    text not null,
  user_id    uuid not null references auth.users(id) on delete cascade,
  quote      text not null check (char_length(quote) between 1 and 2000),
  created_at timestamptz not null default now()
);

alter table public.highlights enable row level security;

-- Private: a reader can only ever see/insert/delete their OWN highlights.
-- (Admin can view all via the Supabase dashboard / service role.)
create policy "users read own highlights" on public.highlights
  for select using (auth.uid() = user_id);
create policy "users insert own highlights" on public.highlights
  for insert with check (auth.uid() = user_id);
create policy "users delete own highlights" on public.highlights
  for delete using (auth.uid() = user_id);

create index if not exists highlights_post_user_idx on public.highlights (post_id, user_id);
