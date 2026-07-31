-- ============================================================================
-- comments-threads.sql — upgrade the post comment thread for the design's UI.
-- Run ONCE in the Supabase SQL editor. Idempotent.
--
-- Adds:
--   1. comments.parent_id — one level of threading (a reply to a comment). Null =
--      a top-level comment. ON DELETE CASCADE so removing a parent removes replies.
--   2. comments.author_is_admin — set SERVER-SIDE on insert (never client-trusted)
--      so the thread can badge the author's replies with "Author" honestly.
--
-- Flat comments keep working without this; threading + the badge need it applied.
-- The existing SELECT/INSERT RLS policies on `comments` already cover the new
-- columns (parent_id is just a fk; author_is_admin is set by the trigger).
-- ============================================================================

alter table public.comments add column if not exists parent_id uuid references public.comments(id) on delete cascade;
create index if not exists comments_parent_idx on public.comments(parent_id);

alter table public.comments add column if not exists author_is_admin boolean not null default false;

create or replace function public.set_comment_admin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.author_is_admin := coalesce(public.is_admin(), false);
  return new;
end $$;

drop trigger if exists trg_comment_admin on public.comments;
create trigger trg_comment_admin before insert on public.comments
  for each row execute function public.set_comment_admin();
