-- =============================================================================
-- db/my-library.sql — public.my_library: the signed-in reader's full reading history from
-- reader_progress (finished + in-progress), for the /account "Still reading" + "Library" sections.
-- Replaces the account's old entitlements-based library (the paywall was dropped, so entitlements
-- no longer accrue). Everything real: pct/read/updated_at are the reader's own rows; the resume
-- anchor + heading come straight from reader_progress. auth.uid()-scoped. Idempotent.
-- Apply: node --env-file=.env scripts/apply-sql.mjs db/my-library.sql
-- =============================================================================
drop function if exists public.my_library(int);
create or replace function public.my_library(p_limit int default 80)
returns table (
  slug text, title text, author_name text, handle citext,
  pct int, read boolean, reading_min int, updated_at timestamptz, anchor text, heading text
)
language sql stable security definer set search_path = public, content, extensions as $$
  select p.slug, p.title, pr.pen_name, pr.handle,
         rp.pct::int, rp.read, p.reading_min, rp.updated_at, rp.anchor, rp.heading
  from public.reader_progress rp
  join content.posts p on p.slug = rp.post_slug
    and p.status = 'published' and p.visibility = 'public' and p.deleted_at is null
  join content.profiles pr on pr.id = p.author_id
  where rp.user_id = auth.uid()
  order by rp.read asc, rp.updated_at desc      -- in-progress first, then most-recently finished
  limit least(greatest(p_limit, 1), 200);
$$;
grant execute on function public.my_library(int) to authenticated;
notify pgrst, 'reload schema';
