-- Owned email list — subscribers table with double opt-in.
-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New query).

create table if not exists public.subscribers (
  id                uuid primary key default gen_random_uuid(),
  email             text unique not null,
  status            text not null default 'pending'
                      check (status in ('pending', 'confirmed', 'unsubscribed')),
  confirm_token     uuid,
  last_email_at     timestamptz,
  unsubscribe_token uuid not null default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  confirmed_at      timestamptz
);

-- Lock the table down: enable RLS with NO policies. The anon/public API key then
-- has zero access; only the service-role key (used by the Cloudflare Function,
-- which bypasses RLS) can read/write. Never expose the service-role key client-side.
alter table public.subscribers enable row level security;

create index if not exists subscribers_confirm_token_idx on public.subscribers (confirm_token);
create index if not exists subscribers_unsub_token_idx  on public.subscribers (unsubscribe_token);
