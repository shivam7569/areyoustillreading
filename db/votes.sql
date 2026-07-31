-- ============================================================================
-- votes.sql — upvotes for post comments AND highlight-discussion replies.
-- Run ONCE in the Supabase SQL editor. Idempotent.
--
-- One polymorphic table keyed by (user_id, kind, target_id) so a user can vote a
-- given comment/reply at most once (composite PK enforces it). `kind` is
-- 'comment' (public post comments) or 'hlcomment' (highlight discussion replies).
--
-- RLS: reads are public (upvote counts aren't secret — like any forum); a user
-- may only insert/delete their OWN vote. Counting is done client-side over the
-- visible targets (fine for a personal blog's volume).
-- ============================================================================

create table if not exists public.votes (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('comment', 'hlcomment')),
  target_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, kind, target_id)
);

create index if not exists votes_target_idx on public.votes(kind, target_id);

alter table public.votes enable row level security;

drop policy if exists "votes read" on public.votes;
create policy "votes read" on public.votes for select using (true);

drop policy if exists "votes insert own" on public.votes;
create policy "votes insert own" on public.votes for insert with check (auth.uid() = user_id);

drop policy if exists "votes delete own" on public.votes;
create policy "votes delete own" on public.votes for delete using (auth.uid() = user_id);
