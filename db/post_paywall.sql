-- Admin-controlled per-post paywall status (the live "Add / Remove from paywall"
-- toggle). Requires public.is_admin() from db/highlights.sql. Run once.

create table if not exists public.post_paywall (
  post_id     text primary key,
  is_paid     boolean not null default true,
  price_cents integer not null default 500,
  currency    text not null default 'usd',
  product_id  text,
  updated_at  timestamptz not null default now()
);
alter table public.post_paywall add column if not exists product_id text;

alter table public.post_paywall enable row level security;

-- Anyone may read whether a post is currently paywalled (to render the unlock UI).
drop policy if exists "paywall read all" on public.post_paywall;
create policy "paywall read all" on public.post_paywall for select using (true);

-- Only the admin can add/remove a post from the paywall or change its price.
drop policy if exists "paywall admin insert" on public.post_paywall;
drop policy if exists "paywall admin update" on public.post_paywall;
drop policy if exists "paywall admin delete" on public.post_paywall;
create policy "paywall admin insert" on public.post_paywall
  for insert with check (public.is_admin());
create policy "paywall admin update" on public.post_paywall
  for update using (public.is_admin()) with check (public.is_admin());
create policy "paywall admin delete" on public.post_paywall
  for delete using (public.is_admin());
