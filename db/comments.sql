-- Comments on blog posts. Run once in the Supabase SQL editor.

create table if not exists public.comments (
  id          uuid primary key default gen_random_uuid(),
  post_id     text not null,
  user_id     uuid not null references auth.users(id) on delete cascade,
  author_name text not null,
  body        text not null check (char_length(body) between 1 and 4000),
  created_at  timestamptz not null default now()
);

alter table public.comments enable row level security;

-- Anyone (even signed-out) can read comments.
create policy "comments are public" on public.comments
  for select using (true);

-- Signed-in users can add a comment as themselves.
create policy "users insert own comments" on public.comments
  for insert with check (auth.uid() = user_id);

-- Users can delete their own comments.
create policy "users delete own comments" on public.comments
  for delete using (auth.uid() = user_id);

create index if not exists comments_post_id_idx on public.comments (post_id, created_at);
