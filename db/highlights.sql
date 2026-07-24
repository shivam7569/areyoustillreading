-- Highlights + per-highlight reader↔admin discussion.
-- Run once in the Supabase SQL editor. Safe to re-run (idempotent).

-- 1) Admins (the site owner). After signing in once, find your user id in
--    Supabase → Authentication → Users, then run:
--       insert into public.admins (user_id) values ('<your-user-uuid>');
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.admins enable row level security;
-- No select policy: membership is only ever checked via is_admin() below.

create or replace function public.is_admin() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- 2) Highlights — a reader sees their own; the admin sees everyone's.
create table if not exists public.highlights (
  id          uuid primary key default gen_random_uuid(),
  post_id     text not null,
  user_id     uuid not null references auth.users(id) on delete cascade,
  author_name text not null default 'Reader',
  quote       text not null check (char_length(quote) between 1 and 2000),
  created_at  timestamptz not null default now()
);
alter table public.highlights add column if not exists author_name text not null default 'Reader';
alter table public.highlights enable row level security;

drop policy if exists "users read own highlights" on public.highlights;
drop policy if exists "users insert own highlights" on public.highlights;
drop policy if exists "users delete own highlights" on public.highlights;
drop policy if exists "hl read own or admin" on public.highlights;
drop policy if exists "hl insert own" on public.highlights;
drop policy if exists "hl delete own or admin" on public.highlights;
create policy "hl read own or admin" on public.highlights
  for select using (auth.uid() = user_id or public.is_admin());
create policy "hl insert own" on public.highlights
  for insert with check (auth.uid() = user_id);
create policy "hl delete own or admin" on public.highlights
  for delete using (auth.uid() = user_id or public.is_admin());
create index if not exists highlights_post_user_idx on public.highlights (post_id, user_id);

-- 3) Discussion on a highlight — visible only to that highlight's reader + admin.
create table if not exists public.highlight_comments (
  id           uuid primary key default gen_random_uuid(),
  highlight_id uuid not null references public.highlights(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  author_name  text not null,
  body         text not null check (char_length(body) between 1 and 4000),
  created_at   timestamptz not null default now()
);
alter table public.highlight_comments enable row level security;

drop policy if exists "hc read" on public.highlight_comments;
drop policy if exists "hc insert" on public.highlight_comments;
drop policy if exists "hc delete" on public.highlight_comments;
create policy "hc read" on public.highlight_comments for select using (
  public.is_admin()
  or exists (select 1 from public.highlights h where h.id = highlight_id and h.user_id = auth.uid())
);
create policy "hc insert" on public.highlight_comments for insert with check (
  auth.uid() = user_id
  and (
    public.is_admin()
    or exists (select 1 from public.highlights h where h.id = highlight_id and h.user_id = auth.uid())
  )
);
create policy "hc delete" on public.highlight_comments for delete using (
  auth.uid() = user_id or public.is_admin()
);
create index if not exists highlight_comments_hid_idx on public.highlight_comments (highlight_id, created_at);
