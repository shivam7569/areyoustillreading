-- =============================================================================
-- db/admins-manage.sql — manage site admins BY EMAIL from the Studio.
-- -----------------------------------------------------------------------------
-- The admin set is public.admins (see db/highlights.sql): one row per admin,
-- keyed by auth user_id, with NO client-facing RLS policy (only ever tested via
-- is_admin()). That's the right storage, but it means "add/remove an admin by
-- their email" can't be done from the browser — a client can neither read the
-- table nor resolve an email to a user_id (auth.users is not client-readable).
--
-- This file adds three SECURITY DEFINER helpers that do exactly that, and locks
-- them so ONLY the service role can call them. The /api/admin/admins Pages
-- Function calls them with the service-role key AFTER requireAdmin() has proven
-- the caller is already an admin — so the server, not these functions, is the
-- trust boundary. A normal signed-in reader (authenticated role) is denied
-- EXECUTE, so they can never invoke these even with a valid JWT.
--
-- Re-runnable (create-or-replace + add-column-if-not-exists). Run the whole file
-- once in the Supabase SQL editor.
-- =============================================================================

-- Audit columns on the existing table (safe if already present). created_at lets
-- the Studio show when each admin was granted; added_by records who granted them.
alter table public.admins add column if not exists created_at timestamptz not null default now();
alter table public.admins add column if not exists added_by  uuid references auth.users(id) on delete set null;

-- ── admin_list() → the current admins with their email + grant time ──────────
-- SECURITY DEFINER so it can join auth.users (not readable by normal roles) and
-- read public.admins (no select policy). search_path pinned to public to prevent
-- object-shadowing escalation; auth.users is fully schema-qualified so the pin
-- doesn't hide it.
create or replace function public.admin_list()
returns table (user_id uuid, email text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select a.user_id, u.email::text, a.created_at
  from public.admins a
  join auth.users u on u.id = a.user_id
  order by a.created_at asc nulls first, u.email asc;
$$;

-- ── admin_add_by_email(email, actor) → 'added' | 'already' | 'no_user' ───────
-- Resolves the email to an auth user (case-insensitive) and inserts them into
-- public.admins. 'no_user' means nobody has ever signed in with that email — they
-- must create their account (sign in once) before they can be made an admin.
create or replace function public.admin_add_by_email(p_email text, p_actor uuid default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  -- Serialize all admin mutations against each other so the last-admin guard in
  -- admin_remove_by_email() is atomic (a plain count() is a check-then-act race).
  -- Transaction-scoped: auto-released when this RPC's implicit txn commits.
  perform pg_advisory_xact_lock(hashtext('aysr:admins')::bigint);
  select id into v_id from auth.users where lower(email) = lower(trim(p_email)) limit 1;
  if v_id is null then return 'no_user'; end if;
  if exists (select 1 from public.admins where user_id = v_id) then return 'already'; end if;
  insert into public.admins (user_id, added_by) values (v_id, p_actor);
  return 'added';
end;
$$;

-- ── admin_remove_by_email(email) → 'removed' | 'not_admin' | 'no_user'
--                                   | 'last_admin' ───────────────────────────
-- Revokes admin from the email's user. Refuses to remove the LAST admin, so the
-- site can never be locked out of its own Studio. (Removing yourself is allowed
-- as long as another admin remains; the UI confirms that case.)
create or replace function public.admin_remove_by_email(p_email text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_count int;
begin
  -- Same serialization lock as admin_add_by_email — makes the count()+delete below
  -- atomic so two concurrent removals of different admins can't both pass the guard
  -- and empty the table (owner lockout).
  perform pg_advisory_xact_lock(hashtext('aysr:admins')::bigint);
  select id into v_id from auth.users where lower(email) = lower(trim(p_email)) limit 1;
  if v_id is null then return 'no_user'; end if;
  if not exists (select 1 from public.admins where user_id = v_id) then return 'not_admin'; end if;
  select count(*) into v_count from public.admins;
  if v_count <= 1 then return 'last_admin'; end if;
  delete from public.admins where user_id = v_id;
  return 'removed';
end;
$$;

-- ── Lock down: server-only. CRITICAL — revoke EXECUTE from the concrete PostgREST
-- roles, not just PUBLIC. Supabase's bootstrap runs
--   alter default privileges in schema public grant all on functions
--     to anon, authenticated, service_role;
-- so a function created here gets a DIRECT execute grant to anon+authenticated at
-- creation time. `revoke ... from public` removes ONLY the PUBLIC pseudo-role grant
-- and leaves those direct grants intact — which would let ANY signed-in (or even
-- anonymous, via the public anon key) caller invoke these SECURITY DEFINER functions
-- straight through PostgREST (POST /rest/v1/rpc/admin_add_by_email {p_email:'me'})
-- and self-promote to admin, bypassing requireAdmin entirely. Revoking from
-- anon+authenticated explicitly closes that hole regardless of ambient defaults.
-- Only the service role (used solely by the /api/admin/admins Function, after
-- requireAdmin) may execute them.
revoke all on function public.admin_list()                    from public, anon, authenticated;
revoke all on function public.admin_add_by_email(text, uuid)  from public, anon, authenticated;
revoke all on function public.admin_remove_by_email(text)     from public, anon, authenticated;
grant execute on function public.admin_list()                   to service_role;
grant execute on function public.admin_add_by_email(text, uuid) to service_role;
grant execute on function public.admin_remove_by_email(text)    to service_role;

-- Verify (optional): after running this file, each of these must return FALSE.
--   select has_function_privilege('anon',          'public.admin_add_by_email(text,uuid)', 'execute');
--   select has_function_privilege('authenticated', 'public.admin_add_by_email(text,uuid)', 'execute');
--   select has_function_privilege('authenticated', 'public.admin_list()',                  'execute');
