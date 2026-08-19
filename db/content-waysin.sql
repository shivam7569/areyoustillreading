-- =============================================================================
-- db/content-waysin.sql — "Ways in": three routes into the archive chosen by how
-- pieces READ, not when they arrived. Public-schema SECURITY DEFINER over the
-- retention shapes in public.analytics_events + content.posts:
--   holds — the piece almost nobody puts down (highest % still there at the end)
--   hard  — loses many in the opening and rewards the ones who stay (steep early drop, real core)
--   quick — short and finished by nearly everyone (fewest minutes, high completion)
-- Each route returns one exemplar post + its reading-shape samples. Distinct posts.
-- Aggregate only; no scores exposed. Idempotent. Depends on db/analytics.sql + db/content.sql.
-- =============================================================================
create or replace function public.ways_in()
returns table (
  route       text,
  slug        text,
  title       text,
  author_name text,
  reading_min int,
  samples     int[]
)
language sql stable security definer set search_path = public, content, extensions as $$
  with reads as (
    select e.slug, count(*)::numeric n
    from public.analytics_events e
    where e.type = 'read'
    group by e.slug
    having count(*) >= 8            -- a shape needs a handful of readers to mean anything
  ),
  shapes as (
    select r.slug, r.n,
      (select array_agg(
         round(100.0 * (
           select count(*) from public.analytics_events e2
           where e2.type = 'read' and e2.slug = r.slug and e2.read_pct >= g.x
         ) / r.n)::int
         order by g.x)
       from generate_series(10, 100, 10) g(x)) as samples
    from reads r
  ),
  enr as (
    select s.slug, s.n, s.samples, p.title, p.reading_min, pr.pen_name,
           s.samples[10] as tail,          -- readers still there at 100%
           100 - s.samples[3] as early     -- how many were lost by 30%
    from shapes s
    join content.posts p on p.slug = s.slug
      and p.status = 'published' and p.visibility = 'public' and p.deleted_at is null
    join content.profiles pr on pr.id = p.author_id
  ),
  holds as (select slug from enr order by tail desc nulls last, n desc limit 1),
  quick as (
    select slug from enr
    where slug not in (select slug from holds) and tail >= 55
    order by reading_min asc, tail desc limit 1
  ),
  hard as (
    select slug from enr
    where slug not in (select slug from holds union all select slug from quick)
      and tail between 38 and 82
    order by early desc, n desc limit 1
  )
  select 'holds', e.slug, e.title, e.pen_name, e.reading_min, e.samples from enr e join holds h on h.slug = e.slug
  union all
  select 'hard',  e.slug, e.title, e.pen_name, e.reading_min, e.samples from enr e join hard  h on h.slug = e.slug
  union all
  select 'quick', e.slug, e.title, e.pen_name, e.reading_min, e.samples from enr e join quick q on q.slug = e.slug;
$$;

grant execute on function public.ways_in() to anon, authenticated;

-- VERIFY (optional): select route, slug, reading_min, samples from public.ways_in();
