-- =============================================================================
-- db/content-series-authoring.sql — attach a DB post to its author's OWN series.
-- The authoring-side series parity for the one-URL collapse: the editor collects a
-- series name/order/total/status/planned, and this lets the DB publish path create or
-- update the author's series (content.series is unexposed to PostgREST, so the app needs
-- these public wrappers) and attach the post at a position — SELF-ACCEPTED, since the post
-- and the series share one owner (no co-author consent needed). A post lives in at most one
-- series (mirrors the file model's single `series` frontmatter), so attach first detaches it
-- from the caller's other series. service-role ONLY (called by /api/author/post behind
-- requireAuthor, which passes the validated p_caller). Idempotent.
-- Apply:  node --env-file=.env scripts/apply-sql.mjs db/content-series-authoring.sql
-- =============================================================================

-- Create/find the caller's series (by owner+slug) and attach p_post at p_position.
create or replace function public.author_attach_series(
  p_caller uuid, p_post_id uuid, p_series_slug text, p_series_title text,
  p_summary text default '', p_total int default null, p_status text default '',
  p_planned text[] default '{}', p_position int default 0)
returns uuid language plpgsql security definer set search_path = public, content, extensions as $$
declare v_series_id uuid; v_status content.series_state;
begin
  if not (content.is_active_author(p_caller) or content.is_owner(p_caller)) then raise exception 'not an active author'; end if;
  if not exists (select 1 from content.posts where id = p_post_id and deleted_at is null) then raise exception 'post not found'; end if;
  if not (content.is_post_author(p_post_id, p_caller) or content.is_owner(p_caller)) then raise exception 'not authorized for this post'; end if;
  if coalesce(nullif(btrim(p_series_slug), ''), '') = '' then raise exception 'series slug required'; end if;
  v_status := case when p_status in ('in-progress','complete','paused') then p_status::content.series_state else 'in-progress'::content.series_state end;

  -- find-or-create the caller's own (non-deleted) series. Match by slug FIRST, else by TITLE
  -- (case-insensitive) — a backfilled series' slug came from the file `series` frontmatter and
  -- can differ from the editor's slugify(title) (e.g. title "The retrieval stack" slugifies to
  -- "the-retrieval-stack" but the existing series is "retrieval-demo"), which would otherwise
  -- create a DUPLICATE. Title match reuses the existing series instead.
  select id into v_series_id from content.series where owner_id = p_caller and slug = p_series_slug and deleted_at is null;
  if v_series_id is null and coalesce(nullif(btrim(p_series_title), ''), '') <> '' then
    select id into v_series_id from content.series
      where owner_id = p_caller and lower(btrim(title)) = lower(btrim(p_series_title)) and deleted_at is null
      order by created_at limit 1;
  end if;
  if v_series_id is null then
    insert into content.series (owner_id, slug, title, summary, total, status, planned)
      values (p_caller, p_series_slug, coalesce(p_series_title, ''), coalesce(p_summary, ''), p_total, v_status, coalesce(p_planned, '{}'))
      returning id into v_series_id;
  else
    update content.series set
      title = coalesce(nullif(btrim(p_series_title), ''), title),
      summary = coalesce(p_summary, summary),
      total = coalesce(p_total, total),
      status = v_status,
      planned = coalesce(p_planned, planned),
      updated_at = now()
    where id = v_series_id;
  end if;

  -- one series per post: drop it from any OTHER series this author owns, then attach here.
  delete from content.series_posts sp using content.series se
    where sp.post_id = p_post_id and sp.series_id = se.id and se.owner_id = p_caller and se.id <> v_series_id;
  insert into content.series_posts (series_id, post_id, position, accepted, invited_by)
    values (v_series_id, p_post_id, coalesce(p_position, 0), true, p_caller)
  on conflict (series_id, post_id) do update set position = excluded.position, accepted = true;

  return v_series_id;
end $$;

-- Remove p_post from any series the caller owns (the author cleared the series field).
create or replace function public.author_clear_series(p_caller uuid, p_post_id uuid)
returns void language plpgsql security definer set search_path = public, content, extensions as $$
begin
  if not (content.is_active_author(p_caller) or content.is_owner(p_caller)) then raise exception 'not an active author'; end if;
  delete from content.series_posts sp using content.series se
    where sp.post_id = p_post_id and sp.series_id = se.id and se.owner_id = p_caller;
end $$;

revoke all on function public.author_attach_series(uuid,uuid,text,text,text,int,text,text[],int) from public, anon, authenticated;
revoke all on function public.author_clear_series(uuid,uuid)                                   from public, anon, authenticated;
grant execute on function public.author_attach_series(uuid,uuid,text,text,text,int,text,text[],int) to service_role;
grant execute on function public.author_clear_series(uuid,uuid)                                   to service_role;

notify pgrst, 'reload schema';
