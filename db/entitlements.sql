-- Per-post purchase entitlements (one-time, unlock-for-life).
-- Rows are written ONLY by the Stripe webhook (service-role key, bypasses RLS).
-- Run once in the Supabase SQL editor.

create table if not exists public.entitlements (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  post_id    text not null,
  created_at timestamptz not null default now(),
  unique (user_id, post_id)
);

alter table public.entitlements enable row level security;

-- Readers may check their OWN entitlements (to unlock content client-side).
-- There is deliberately NO insert/update/delete policy: only the webhook,
-- using the service-role key, ever writes here.
drop policy if exists "entitlements read own" on public.entitlements;
create policy "entitlements read own" on public.entitlements
  for select using (auth.uid() = user_id);

create index if not exists entitlements_user_post_idx on public.entitlements (user_id, post_id);
