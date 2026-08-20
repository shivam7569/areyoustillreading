-- =============================================================================
-- db/content-continue.sql — "Where you left off": the signed-in reader's own
-- in-progress pieces, for the feed's resume strip. Public-schema SECURITY DEFINER
-- keyed to auth.uid() (the CALLER) — a reader only ever sees their OWN progress.
-- Joins public.reader_progress to content.posts (published/public only) and returns
-- just enough to draw a card: title, author, how far in, and the length. Ordered by
-- most-recently-touched. authenticated only (anon has no progress).
-- Idempotent. Depends on db/reader-progress.sql + db/content.sql.
-- =============================================================================
-- Added the handle OUT column → drop before recreate (OUT signature can't be replaced in place).
drop function if exists public.my_reading_continues(int);
create or replace function public.my_reading_continues(p_limit int default 3)
returns table (
  slug        text,
  title       text,
  author_name text,
  handle      citext,           -- the post author's @handle → canonical /@handle/slug resume link
  pct         int,
  reading_min int
)
language sql stable security definer set search_path = public, content, extensions as $$
  select p.slug, p.title, pr.pen_name, pr.handle, rp.pct::int, p.reading_min
  from public.reader_progress rp
  join content.posts p on p.slug = rp.post_slug
    and p.status = 'published' and p.visibility = 'public' and p.deleted_at is null
  join content.profiles pr on pr.id = p.author_id
  where rp.user_id = auth.uid()               -- the caller, inside a definer function
    and coalesce(rp.read, false) = false      -- finished pieces drop off the strip
    and rp.pct between 1 and 99               -- only things genuinely mid-read
  order by rp.updated_at desc
  limit least(greatest(p_limit, 1), 6);
$$;

grant execute on function public.my_reading_continues(int) to authenticated;

notify pgrst, 'reload schema';

-- VERIFY (optional, impersonating a reader):
--   set local role authenticated; select set_config('request.jwt.claim.sub', '<uuid>', true);
--   select * from public.my_reading_continues(3);
