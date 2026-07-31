-- ============================================================================
-- highlights-notes.sql — upgrade the reader-highlight backend for the design's
-- full feature set. Run ONCE in the Supabase SQL editor.
--
-- Adds:
--   1. highlights.note  — a private per-highlight note (design's note affordance),
--      plus an UPDATE policy so a highlight's OWNER (only) can edit its note.
--   2. highlight_comments.author_is_admin — set SERVER-SIDE on insert (never
--      client-trusted) so the discussion thread can badge the author's replies
--      with "Author" honestly. Populated by a trigger via is_admin().
--
-- Idempotent: safe to re-run. Basic highlighting works WITHOUT this migration;
-- notes + the Author badge light up once it's applied.
-- ============================================================================

-- 1. Per-highlight private note ------------------------------------------------
alter table public.highlights add column if not exists note text;

-- Owner-only UPDATE (the note is the only mutable field; RLS still checks uid).
drop policy if exists "hl update own" on public.highlights;
create policy "hl update own" on public.highlights
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 2. Honest "Author" badge on highlight discussion ----------------------------
alter table public.highlight_comments
  add column if not exists author_is_admin boolean not null default false;

-- Stamp author_is_admin from is_admin() at insert time — the client cannot set
-- it. SECURITY DEFINER so the function can read the admins table; auth.uid()
-- inside it is still the INSERTING user (from the request JWT), which is what we
-- want to evaluate.
create or replace function public.set_highlight_comment_admin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.author_is_admin := coalesce(public.is_admin(), false);
  return new;
end $$;

drop trigger if exists trg_hc_admin on public.highlight_comments;
create trigger trg_hc_admin before insert on public.highlight_comments
  for each row execute function public.set_highlight_comment_admin();

-- 3. "Many readers marked this" (design .pop) — PRIVACY-SAFE ------------------
-- Returns ONLY the passage TEXT of quotes highlighted by >= p_min DISTINCT readers
-- (normalised for whitespace/case so near-identical selections cluster). No counts,
-- no user identity — a reader still can't see WHO or HOW MANY. SECURITY DEFINER so
-- it can aggregate across all readers (RLS otherwise scopes to own rows). Callable
-- by anyone (the "popular" hint is public), but it never leaks individual highlights.
create or replace function public.highlight_popular(p_post_id text, p_min int default 3)
returns table(quote text) language sql security definer set search_path = public stable as $$
  select (array_agg(h.quote order by length(h.quote) desc))[1] as quote
  from public.highlights h
  where h.post_id = p_post_id
  group by regexp_replace(btrim(lower(h.quote)), '\s+', ' ', 'g')
  having count(distinct h.user_id) >= p_min;
$$;
grant execute on function public.highlight_popular(text, int) to anon, authenticated;
