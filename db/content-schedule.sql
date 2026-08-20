-- =============================================================================
-- db/content-schedule.sql — schedule a DB post + flip due scheduled posts live.
-- The authoring-side scheduling parity (the last blocker to editor DB-only). Unlike a
-- file post (schedule = a hidden draft that a cron commits + rebuilds), a scheduled DB
-- post stores its already-rendered body_html + status='scheduled' + publish_at, and a cron
-- just FLIPS status → 'published' when due — instantly live (get_public_post serves from the
-- DB, no rebuild). The reader RPCs filter status='published', so a scheduled post is hidden
-- until it flips.
--   public.author_schedule_post — store the rendered body + status='scheduled' + publish_at.
--                                 service-role (called by /api/author/publish behind requireAuthor).
--   public.flip_scheduled_posts — flip every due scheduled post to published. Called by the cron
--                                 (scripts/flip-scheduled-db.mjs, extending scheduled-publish.yml).
-- Idempotent. Apply:  node --env-file=.env scripts/apply-sql.mjs db/content-schedule.sql
-- =============================================================================

create or replace function public.author_schedule_post(
  p_caller uuid, p_post_id uuid, p_body_html text, p_body_text text, p_reading_min int, p_publish_at timestamptz)
returns table (slug text, handle citext, status text, publish_at timestamptz)
language plpgsql security definer set search_path = public, content, extensions as $$
-- The OUT column names (slug/status/publish_at) match content.posts columns; make bare
-- references in the UPDATE below resolve to the COLUMN, not the OUT variable.
#variable_conflict use_column
declare v_row content.posts;
begin
  select * into v_row from content.posts where id = p_post_id and deleted_at is null;
  if not found then raise exception 'post not found'; end if;
  if not (content.is_post_author(p_post_id, p_caller) or content.is_owner(p_caller)) then
    raise exception 'not authorized to schedule this post';
  end if;
  -- Scheduling is a deferred publish, so it needs the same permission as publish_post.
  if not content.is_owner(p_caller)
     and not exists (select 1 from content.profiles where id = v_row.author_id and can_publish and status = 'active' and deleted_at is null) then
    raise exception 'author not permitted to publish';
  end if;
  if p_publish_at is null or p_publish_at <= now() then raise exception 'publish_at must be in the future'; end if;

  update content.posts set
    body_html = p_body_html, body_text = p_body_text, reading_min = coalesce(p_reading_min, reading_min),
    published_md = body_md, status = 'scheduled', publish_at = p_publish_at,
    current_version = current_version + 1, updated_at = now()
  where id = p_post_id
  returning * into v_row;
  return query select v_row.slug, pr.handle, v_row.status::text, v_row.publish_at
    from content.profiles pr where pr.id = v_row.author_id;
end $$;

-- Flip every scheduled post whose time has come. Returns how many went live.
create or replace function public.flip_scheduled_posts()
returns int language plpgsql security definer set search_path = public, content, extensions as $$
declare v_count int;
begin
  update content.posts set
    status = 'published', published_at = coalesce(published_at, now()), updated_at = now()
  where status = 'scheduled' and publish_at is not null and publish_at <= now() and deleted_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function public.author_schedule_post(uuid,uuid,text,text,int,timestamptz) from public, anon, authenticated;
revoke all on function public.flip_scheduled_posts()                                    from public, anon, authenticated;
grant execute on function public.author_schedule_post(uuid,uuid,text,text,int,timestamptz) to service_role;
grant execute on function public.flip_scheduled_posts()                                    to service_role;

-- ── auto-flip via pg_cron (self-contained INSIDE Supabase — no external cron, no GH secret) ──
-- flip_scheduled_posts() runs every minute, so a scheduled DB post goes live within ~1 min of its
-- time. This is the primary mechanism (a DB flip is instant — the reader serves from the DB, no
-- rebuild). Idempotent: enable the extension, drop any prior job of this name, then (re)schedule.
create extension if not exists pg_cron;
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'flip-scheduled-posts';
exception when others then null;  -- no prior job, or cron not ready — the schedule below still runs
end $$;
select cron.schedule('flip-scheduled-posts', '* * * * *', 'select public.flip_scheduled_posts()');

notify pgrst, 'reload schema';
