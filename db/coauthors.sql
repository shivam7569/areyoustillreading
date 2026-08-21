-- =============================================================================
-- db/coauthors.sql — the two read/lookup RPCs the Write editor's "Invite a co-author" panel
-- needs (Collaboration design, surface 1). The mutations already exist in db/content-collab.sql
-- + db/collab-requests.sql (invite_coauthor / remove_coauthor / respond_coauthor); the invitee
-- ACCEPTS from their Studio Requests inbox. Idempotent.
--
-- We invite by @handle, not email: on an invite-only platform a co-author is already an author,
-- @handle is their public identity (shown everywhere), and an exact-handle lookup can't be used
-- to enumerate accounts the way an email probe could. Someone with no account yet is the owner's
-- "invite an author" flow, not this one.
-- Apply: node --env-file=.env scripts/apply-sql.mjs db/coauthors.sql
-- =============================================================================

-- Resolve an exact @handle to an ACTIVE author (for the invite field). Nothing for a non-author.
drop function if exists public.find_author(text);
create or replace function public.find_author(p_query text)
returns table (id uuid, handle text, name text)
language sql stable security definer set search_path = content, public, extensions as $$
  select pr.id, pr.handle::text, coalesce(pr.pen_name, pr.handle)::text
  from content.profiles pr
  where pr.handle is not null
    and lower(pr.handle::text) = lower(ltrim(trim(p_query), '@'))
    and content.is_active_author(pr.id)
  limit 1;
$$;
grant execute on function public.find_author(text) to authenticated;

-- The full author set of a post (accepted + pending), for the editor panel + byline preview.
-- Only a current author of the post may read it.
drop function if exists public.post_coauthors(uuid);
create or replace function public.post_coauthors(p_post uuid)
returns table (user_id uuid, handle text, name text, accepted boolean, is_primary boolean, note text)
language sql stable security definer set search_path = content, public, extensions as $$
  select pa.user_id, pr.handle::text, coalesce(pr.pen_name, pr.handle)::text,
         pa.accepted, (pa.position = 0), pa.note
  from content.post_authors pa
  join content.profiles pr on pr.id = pa.user_id
  where pa.post_id = p_post
    and content.is_post_author(p_post, auth.uid())
  order by pa.position;
$$;
grant execute on function public.post_coauthors(uuid) to authenticated;

notify pgrst, 'reload schema';
