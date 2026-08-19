-- =============================================================================
-- db/content-feed.sql — the multi-author feed read RPC (the "Everyone" stream).
-- Public-schema SECURITY DEFINER over content.*, published+public only, incl. the
-- co-author byline (from content.post_authors) and one series crumb per post.
-- Idempotent. Depends on db/content.sql + db/content-collab.sql.
-- =============================================================================
create or replace function public.list_feed_posts(p_limit int default 25, p_before timestamptz default null)
returns table (
  post_id       uuid,
  slug          text,
  title         text,
  description   text,
  tags          text[],
  pub_date      timestamptz,
  reading_min   int,
  primary_handle citext,
  primary_name  text,
  author_count  int,
  author_names  text[],
  series_slug   text,
  series_title  text,
  series_part   int,
  series_total  int
)
language sql stable security definer set search_path = public, content, extensions as $$
  select
    po.id, po.slug, po.title, po.description, po.tags, po.pub_date, po.reading_min,
    pr.handle, pr.pen_name,
    (select count(*)::int from content.post_authors pa where pa.post_id = po.id and pa.accepted),
    (select array_agg(p2.pen_name order by pa.position)
       from content.post_authors pa join content.profiles p2 on p2.id = pa.user_id
       where pa.post_id = po.id and pa.accepted),
    ser.slug, ser.title, ser.part, ser.total
  from content.posts po
  join content.profiles pr on pr.id = po.author_id
  left join lateral (
    select se.slug, se.title, sp.position as part, se.total
    from content.series_posts sp
    join content.series se on se.id = sp.series_id and se.deleted_at is null
    where sp.post_id = po.id and sp.accepted
    order by se.created_at
    limit 1
  ) ser on true
  where po.status = 'published' and po.visibility = 'public' and po.deleted_at is null
    and (p_before is null or po.pub_date < p_before)
  order by po.pub_date desc nulls last
  limit least(greatest(p_limit, 1), 50);
$$;

grant execute on function public.list_feed_posts(int, timestamptz) to anon, authenticated;

-- VERIFY (optional): select * from public.list_feed_posts(3, null);
