-- =============================================================================
-- db/attach-targets.sql — the pick-lists for the Studio "Ask to attach" composer.
-- The reader aggregations (list_public_series/…) deliberately don't expose row UUIDs; the
-- collaboration RPCs need them. These two are authenticated-only and return the UUID plus enough
-- to render a human row (title, owner, counts, whether it's mine). UUIDs are opaque identifiers
-- used only inside authenticated RPC calls — never shown in the UI, never in a URL.
-- Apply: node --env-file=.env scripts/apply-sql.mjs db/attach-targets.sql
-- =============================================================================

-- Series a post can be attached to: all of mine + everyone else's PUBLIC series.
drop function if exists public.attach_targets_series();
create or replace function public.attach_targets_series()
returns table (id uuid, title text, owner_handle text, owner_name text, published int, total int, is_mine boolean)
language sql stable security definer set search_path = content, public, extensions as $$
  select se.id, se.title::text, pr.handle::text, coalesce(pr.pen_name, pr.handle)::text,
    (select count(*)::int from content.series_posts sp join content.posts po on po.id = sp.post_id
       where sp.series_id = se.id and sp.accepted and po.status = 'published' and po.deleted_at is null),
    se.total,
    (se.owner_id = auth.uid())
  from content.series se
  join content.profiles pr on pr.id = se.owner_id
  where se.deleted_at is null
    and (se.owner_id = auth.uid()
      or exists (select 1 from content.series_posts sp join content.posts po on po.id = sp.post_id
                 where sp.series_id = se.id and sp.accepted and po.status = 'published'
                   and po.visibility = 'public' and po.deleted_at is null))
  order by (se.owner_id = auth.uid()) desc, se.title;
$$;
grant execute on function public.attach_targets_series() to authenticated;

-- Fields a series can be attached to: all of mine + everyone else's fields that already hold a series.
drop function if exists public.attach_targets_fields();
create or replace function public.attach_targets_fields()
returns table (id uuid, title text, owner_handle text, owner_name text, series_count int, is_mine boolean)
language sql stable security definer set search_path = content, public, extensions as $$
  select f.id, f.title::text, pr.handle::text, coalesce(pr.pen_name, pr.handle)::text,
    (select count(*)::int from content.field_series fs where fs.field_id = f.id and fs.accepted),
    (f.owner_id = auth.uid())
  from content.fields f
  join content.profiles pr on pr.id = f.owner_id
  where f.deleted_at is null
    and (f.owner_id = auth.uid()
      or exists (select 1 from content.field_series fs where fs.field_id = f.id and fs.accepted))
  order by (f.owner_id = auth.uid()) desc, f.title;
$$;
grant execute on function public.attach_targets_fields() to authenticated;

notify pgrst, 'reload schema';
