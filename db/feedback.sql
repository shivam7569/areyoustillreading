-- =============================================================================
-- db/feedback.sql — "Did it hold?" reader-feedback poll (one tap, no account).
-- -----------------------------------------------------------------------------
-- Every blog post shows a 3-way poll (Held me / Skimmed it / Lost me) plus, for
-- "Lost me", the paragraph where attention broke. It is ANONYMOUS: readers never
-- sign in. Exactly like analytics_events, this table is written ONLY by the
-- server (the /api/feedback Pages Function, holding the service-role key) and is
-- deny-all under RLS — the browser never touches it directly. The reader is
-- identified by an opaque, per-browser id kept in localStorage (aysr:fid); it is
-- not PII and nothing is ever published under anyone's name.
--
-- Apply by hand in the Supabase SQL editor (there is no migration runner). Safe to
-- re-run: guarded with IF NOT EXISTS + drop-then-create for the policy.
-- =============================================================================

create table if not exists public.feedback (
  id          bigint generated always as identity primary key,
  post_id     text        not null,                 -- the post slug (matches analytics.slug / comments.post_id)
  session     text        not null,                 -- opaque per-browser id (localStorage aysr:fid)
  choice      text        not null check (choice in ('held', 'skimmed', 'lost')),
  lost_para   int         check (lost_para is null or lost_para between 1 and 1000),
  read_pct    int         check (read_pct is null or read_pct between 0 and 100),
  dwell_ms    int         check (dwell_ms is null or dwell_ms >= 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (post_id, session)                          -- one answer per browser per post (upsert on change)
);

create index if not exists feedback_post_idx on public.feedback (post_id);

-- Keep updated_at fresh on re-answer (the upsert path).
create or replace function public.feedback_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists feedback_touch on public.feedback;
create trigger feedback_touch before update on public.feedback
  for each row execute function public.feedback_touch();

-- Deny-all RLS: no policies means anon/authenticated get nothing; only the
-- service-role key (used exclusively by functions/api/feedback.js) bypasses RLS.
-- Same trust model as analytics_events / subscribers — the aggregate the reader
-- sees is computed and returned by the Function, never queried from the browser.
alter table public.feedback enable row level security;
