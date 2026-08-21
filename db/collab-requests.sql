-- =============================================================================
-- db/collab-requests.sql — makes collaboration a real two-sided workflow (the Studio
-- "Collaboration" design: invite a co-author, cross-author attach requests, a requests inbox).
-- Builds on db/content-collab.sql. Idempotent.
--
-- What this adds over the base collab RPCs:
--   * a `note` on every request (post_authors + series_posts; field_series already has one),
--     so an ask can carry the sentence the design asks for.
--   * SYMMETRIC propose/respond: either party may propose a membership and the OTHER party
--     accepts. Before, only the series/field curator could add — so "an author asks to join
--     someone else's series/field" (design surface 3) was impossible. Now:
--        - own series + own post           → auto-accepted (the editor's own curation path)
--        - curator adds someone's post      → that post's author accepts
--        - author asks to join a series      → that series' owner accepts
--     respond_* verifies the caller is the COUNTERPARTY to whoever proposed.
--   * public.my_requests() — one enriched inbox: incoming (needs you) + outgoing (you asked),
--     with the other party's handle/name, the note, the timestamp, and position context.
--
-- Apply: node --env-file=.env scripts/apply-sql.mjs db/collab-requests.sql
-- =============================================================================

-- 1 · notes on the request rows (field_series already carries one) ------------
alter table content.post_authors add column if not exists note text not null default '';
alter table content.series_posts add column if not exists note text not null default '';

-- 2 · co-author invite, now carrying a note ------------------------------------
drop function if exists public.invite_coauthor(uuid, uuid);
create or replace function public.invite_coauthor(p_post uuid, p_invitee uuid, p_note text default '')
returns void language plpgsql security definer set search_path = content, public, extensions as $$
begin
  if not content.is_post_author(p_post, auth.uid()) then raise exception 'not an author of this post'; end if;
  if not content.is_active_author(p_invitee) then raise exception 'invitee is not an author'; end if;
  if p_invitee = auth.uid() then raise exception 'cannot invite yourself'; end if;
  insert into content.post_authors (post_id, user_id, position, accepted, invited_by, note)
    values (p_post, p_invitee,
            coalesce((select max(position) from content.post_authors where post_id = p_post), 0) + 1,
            false, auth.uid(), coalesce(p_note, ''))
  on conflict (post_id, user_id) do update set note = excluded.note, invited_by = excluded.invited_by;
end $$;

-- 3 · series membership — symmetric propose + note -----------------------------
drop function if exists public.add_series_post(uuid, uuid, integer);
create or replace function public.add_series_post(p_series uuid, p_post uuid, p_position int default 0, p_note text default '')
returns void language plpgsql security definer set search_path = content, public, extensions as $$
declare v_owner uuid; v_isauthor boolean;
begin
  select owner_id into v_owner from content.series where id = p_series and deleted_at is null;
  if v_owner is null then raise exception 'no such series'; end if;
  if not exists (select 1 from content.posts where id = p_post and deleted_at is null) then raise exception 'no such post'; end if;
  v_isauthor := content.is_post_author(p_post, auth.uid());
  if auth.uid() <> v_owner and not v_isauthor then raise exception 'not a party to this attachment'; end if;
  insert into content.series_posts (series_id, post_id, position, accepted, invited_by, note)
    values (p_series, p_post, coalesce(p_position, 0),
            (auth.uid() = v_owner and v_isauthor),   -- auto-accept only when you control both sides
            auth.uid(), coalesce(p_note, ''))
  on conflict (series_id, post_id) do update set position = excluded.position, note = excluded.note;
end $$;

create or replace function public.respond_series_post(p_series uuid, p_post uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = content, public, extensions as $$
declare v_owner uuid; v_inv uuid;
begin
  select owner_id into v_owner from content.series where id = p_series;
  select invited_by into v_inv from content.series_posts where series_id = p_series and post_id = p_post and accepted = false;
  if v_inv is null then raise exception 'no pending request'; end if;
  if v_inv = v_owner then                                   -- curator proposed → a post author answers
    if not content.is_post_author(p_post, auth.uid()) then raise exception 'not authorized'; end if;
  else                                                      -- an author proposed → the curator answers
    if auth.uid() <> v_owner then raise exception 'not authorized'; end if;
  end if;
  if p_accept then
    update content.series_posts set accepted = true where series_id = p_series and post_id = p_post;
  else
    delete from content.series_posts where series_id = p_series and post_id = p_post;
  end if;
end $$;

-- 4 · field membership — symmetric propose + note ------------------------------
drop function if exists public.add_field_series(uuid, uuid, integer);
create or replace function public.add_field_series(p_field uuid, p_series uuid, p_position int default 0, p_note text default '')
returns void language plpgsql security definer set search_path = content, public, extensions as $$
declare v_fowner uuid; v_sowner uuid;
begin
  select owner_id into v_fowner from content.fields where id = p_field and deleted_at is null;
  if v_fowner is null then raise exception 'no such field'; end if;
  select owner_id into v_sowner from content.series where id = p_series and deleted_at is null;
  if v_sowner is null then raise exception 'no such series'; end if;
  if auth.uid() <> v_fowner and auth.uid() <> v_sowner then raise exception 'not a party to this attachment'; end if;
  insert into content.field_series (field_id, series_id, position, accepted, invited_by, note)
    values (p_field, p_series, coalesce(p_position, 0),
            (v_fowner = auth.uid() and v_sowner = auth.uid()),
            auth.uid(), coalesce(p_note, ''))
  on conflict (field_id, series_id) do update set position = excluded.position, note = excluded.note;
end $$;

create or replace function public.respond_field_series(p_field uuid, p_series uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = content, public, extensions as $$
declare v_fowner uuid; v_sowner uuid; v_inv uuid;
begin
  select owner_id into v_fowner from content.fields where id = p_field;
  select owner_id into v_sowner from content.series where id = p_series;
  select invited_by into v_inv from content.field_series where field_id = p_field and series_id = p_series and accepted = false;
  if v_inv is null then raise exception 'no pending request'; end if;
  if v_inv = v_fowner then                                  -- field owner proposed → series owner answers
    if auth.uid() <> v_sowner then raise exception 'not authorized'; end if;
  else                                                      -- series owner proposed → field owner answers
    if auth.uid() <> v_fowner then raise exception 'not authorized'; end if;
  end if;
  if p_accept then
    update content.field_series set accepted = true where field_id = p_field and series_id = p_series;
  else
    delete from content.field_series where field_id = p_field and series_id = p_series;
  end if;
end $$;

-- 5 · the inbox: everything waiting on me + everything I'm waiting on ----------
create or replace function public.my_requests()
returns table (
  bucket text, kind text, post_id uuid, series_id uuid, field_id uuid,
  subject_title text, target_title text, counter_handle text, counter_name text,
  note text, created_at timestamptz, seq int
)
language sql stable security definer set search_path = content, public, extensions as $$
  -- co-author invite that needs me
  select 'in', 'coauthor', pa.post_id, null::uuid, null::uuid, po.title, null::text,
         pr.handle::text, coalesce(pr.pen_name, pr.handle)::text, pa.note, pa.created_at, pa.position
    from content.post_authors pa
    join content.posts po on po.id = pa.post_id
    join content.profiles pr on pr.id = pa.invited_by
    where pa.user_id = auth.uid() and pa.accepted = false
  union all
  -- co-author invite I sent, waiting on them
  select 'out', 'coauthor', pa.post_id, null::uuid, null::uuid, po.title, null::text,
         pr.handle::text, coalesce(pr.pen_name, pr.handle)::text, pa.note, pa.created_at, pa.position
    from content.post_authors pa
    join content.posts po on po.id = pa.post_id
    join content.profiles pr on pr.id = pa.user_id
    where pa.invited_by = auth.uid() and pa.accepted = false and pa.user_id <> auth.uid()
  union all
  -- series attach that needs me (I'm the counterparty to whoever proposed)
  select 'in', 'series-post', sp.post_id, sp.series_id, null::uuid, po.title, se.title,
         pr.handle::text, coalesce(pr.pen_name, pr.handle)::text, sp.note, sp.created_at, sp.position
    from content.series_posts sp
    join content.posts po on po.id = sp.post_id
    join content.series se on se.id = sp.series_id
    join content.profiles pr on pr.id = sp.invited_by
    where sp.accepted = false and sp.invited_by <> auth.uid()
      and ((se.owner_id = auth.uid() and sp.invited_by <> se.owner_id)
        or (sp.invited_by = se.owner_id and content.is_post_author(sp.post_id, auth.uid())))
  union all
  -- series attach I proposed, waiting on the counterparty
  select 'out', 'series-post', sp.post_id, sp.series_id, null::uuid, po.title, se.title,
         cp.handle::text, coalesce(cp.pen_name, cp.handle)::text, sp.note, sp.created_at, sp.position
    from content.series_posts sp
    join content.posts po on po.id = sp.post_id
    join content.series se on se.id = sp.series_id
    join content.profiles cp on cp.id = (case when sp.invited_by = se.owner_id then po.author_id else se.owner_id end)
    where sp.accepted = false and sp.invited_by = auth.uid()
  union all
  -- field attach that needs me
  select 'in', 'field-series', null::uuid, fs.series_id, fs.field_id, se.title, fld.title,
         pr.handle::text, coalesce(pr.pen_name, pr.handle)::text, fs.note, fs.created_at, fs.position
    from content.field_series fs
    join content.series se on se.id = fs.series_id
    join content.fields fld on fld.id = fs.field_id
    join content.profiles pr on pr.id = fs.invited_by
    where fs.accepted = false and fs.invited_by <> auth.uid()
      and ((fld.owner_id = auth.uid() and fs.invited_by <> fld.owner_id)
        or (se.owner_id = auth.uid() and fs.invited_by = fld.owner_id))
  union all
  -- field attach I proposed, waiting on the counterparty
  select 'out', 'field-series', null::uuid, fs.series_id, fs.field_id, se.title, fld.title,
         cp.handle::text, coalesce(cp.pen_name, cp.handle)::text, fs.note, fs.created_at, fs.position
    from content.field_series fs
    join content.series se on se.id = fs.series_id
    join content.fields fld on fld.id = fs.field_id
    join content.profiles cp on cp.id = (case when fs.invited_by = fld.owner_id then se.owner_id else fld.owner_id end)
    where fs.accepted = false and fs.invited_by = auth.uid()
  order by created_at desc;
$$;

-- 6 · grants (definer + auth.uid() boundary; anon never) -----------------------
do $$
declare fn text;
begin
  foreach fn in array array[
    'public.invite_coauthor(uuid,uuid,text)',
    'public.add_series_post(uuid,uuid,integer,text)', 'public.respond_series_post(uuid,uuid,boolean)',
    'public.add_field_series(uuid,uuid,integer,text)', 'public.respond_field_series(uuid,uuid,boolean)',
    'public.my_requests()'
  ] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;

notify pgrst, 'reload schema';
