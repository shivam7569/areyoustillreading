-- =============================================================================
-- db/authors-admin.sql — owner-side author roster + invite (public, SECURITY DEFINER).
--   public.list_authors(p_caller)        — the roster for the Studio "Authors" page.
--   public.owner_invite_author(p_caller, p_user_id, p_role) — provision a BARE author
--       profile (handle NULL, empty pen name) so the invited author claims their own
--       permanent @handle at onboarding (per the locked "handle is permanent" decision).
--       provision_profile auto-assigns a handle, which would pre-empt onboarding, so this
--       is a separate, onboarding-friendly path.
-- Owner = is_owner(caller) = present in public.admins. Called only by the gated
-- /api/admin/authors Function (service-role), which passes a validated owner caller.
-- Idempotent. Apply: node --env-file=.env scripts/apply-sql.mjs db/authors-admin.sql
-- =============================================================================

drop function if exists public.list_authors(uuid);
create or replace function public.list_authors(p_caller uuid)
returns table (
  id            uuid,
  email         text,
  handle        citext,
  pen_name      text,
  role          text,
  can_publish   boolean,
  status        text,
  onboarded     boolean,
  published     int,
  created_at    timestamptz
)
language sql stable security definer set search_path = public, content, extensions, auth as $$
  select
    pr.id, u.email::text, pr.handle, pr.pen_name, pr.role::text, pr.can_publish, pr.status::text,
    (pr.handle is not null) as onboarded,
    (select count(*)::int from content.posts po where po.author_id = pr.id and po.status = 'published' and po.deleted_at is null),
    pr.created_at
  from content.profiles pr
  left join auth.users u on u.id = pr.id
  where content.is_owner(p_caller)                     -- only an owner may see the roster
    and pr.role in ('author','editor') and pr.deleted_at is null
  order by pr.created_at;
$$;

-- Provision a bare author profile ready for self-onboarding (handle NULL). Idempotent per user:
-- re-inviting an existing profile just refreshes role/can_publish/status without wiping a handle.
create or replace function public.owner_invite_author(p_caller uuid, p_user_id uuid, p_role text default 'author')
returns content.profiles language plpgsql security definer set search_path = public, content, extensions as $$
declare v_row content.profiles; v_role content.user_role;
begin
  if not content.is_owner(p_caller) then raise exception 'not authorized'; end if;
  v_role := (case when coalesce(p_role,'author') in ('author','editor') then p_role else 'author' end)::content.user_role;
  insert into content.profiles (id, handle, pen_name, role, can_publish, status)
    values (p_user_id, null, '', v_role, true, 'active')
  on conflict (id) do update
    set role = excluded.role, can_publish = true, status = 'active', updated_at = now()
  returning * into v_row;
  return v_row;
end $$;

-- ── public wrappers so the gated Function (PostgREST, public schema only) can drive the
--    owner-only content.* setters (each re-checks is_owner internally) ──────────
create or replace function public.owner_set_role(p_caller uuid, p_user_id uuid, p_role text)
returns void language sql security definer set search_path = public, content, extensions as $$
  select content.set_profile_role(p_caller, p_user_id,
    (case when p_role in ('author','editor','reader') then p_role else 'author' end)::content.user_role);
$$;
create or replace function public.owner_set_can_publish(p_caller uuid, p_user_id uuid, p_value boolean)
returns void language sql security definer set search_path = public, content, extensions as $$
  select content.set_can_publish(p_caller, p_user_id, coalesce(p_value, false));
$$;
create or replace function public.owner_set_status(p_caller uuid, p_user_id uuid, p_status text)
returns void language sql security definer set search_path = public, content, extensions as $$
  select content.set_profile_status(p_caller, p_user_id,
    (case when p_status = 'suspended' then 'suspended' else 'active' end)::content.account_status);
$$;

revoke all on function public.list_authors(uuid)                         from public, anon, authenticated;
revoke all on function public.owner_invite_author(uuid, uuid, text)      from public, anon, authenticated;
revoke all on function public.owner_set_role(uuid, uuid, text)           from public, anon, authenticated;
revoke all on function public.owner_set_can_publish(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.owner_set_status(uuid, uuid, text)         from public, anon, authenticated;
grant execute on function public.list_authors(uuid)                      to service_role;
grant execute on function public.owner_invite_author(uuid, uuid, text)   to service_role;
grant execute on function public.owner_set_role(uuid, uuid, text)        to service_role;
grant execute on function public.owner_set_can_publish(uuid, uuid, boolean) to service_role;
grant execute on function public.owner_set_status(uuid, uuid, text)      to service_role;

notify pgrst, 'reload schema';
