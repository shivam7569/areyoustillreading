-- =============================================================================
-- db/notify.sql — author email notifications for every new reader interaction.
-- -----------------------------------------------------------------------------
-- One AFTER INSERT trigger per interaction table. Each fires a shared trigger
-- function that POSTs the new row to /api/notify (functions/api/notify.js) via the
-- pg_net extension, which emails the author through Resend. Server-authoritative:
-- fires on the real DB write, independent of the reader's browser. Covers comments,
-- highlight discussions, highlights, private notes, and "Did it hold?" feedback
-- (the poll upserts, so AFTER INSERT fires once per reader/post).
--
-- Uses pg_net directly (no "Database Webhooks" UI needed — that menu isn't present
-- in every Supabase version). Runs entirely from the Supabase SQL editor.
--
-- ── ONE-TIME SETUP ──────────────────────────────────────────────────────────
-- 1. Enable the pg_net extension once: Supabase → Database → Extensions →
--    search "pg_net" → toggle ON.  (or it's created by the line below if allowed)
-- 2. Pick a long random secret. Set it in BOTH places, identical:
--      • Cloudflare Pages → Settings → Variables & Secrets → Production:
--          NOTIFY_SECRET = <secret>
--      • the REPLACE_WITH_NOTIFY_SECRET placeholder below (one spot)
-- 3. Also add in Cloudflare Pages:  AUTHOR_EMAIL = you@yourdomain  (where notices go)
--    (RESEND_API_KEY / EMAIL_FROM / SITE_URL are already set for the letter.)
-- 4. Replace the secret below, then run this whole file in the Supabase SQL editor.
--    Re-runnable (create-or-replace + drop-then-create).
--
-- To STOP notifications: unset AUTHOR_EMAIL (the endpoint then no-ops), or drop the
-- triggers. To CHANGE the secret: update both places and re-run this file.
-- =============================================================================

create extension if not exists pg_net;

-- Shared trigger fn: POST { type, table, schema, record } to /api/notify. SECURITY
-- DEFINER so it can call net.* regardless of the inserting role; any error is
-- swallowed so a failed notification can NEVER block the reader's insert.
create or replace function public.notify_author()
returns trigger
language plpgsql
security definer
set search_path = public, net
as $$
begin
  perform net.http_post(
    url     := 'https://areyoustillreading.dev/api/notify',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-notify-secret', 'REPLACE_WITH_NOTIFY_SECRET'
               ),
    body    := jsonb_build_object(
                 'type',   'INSERT',
                 'table',  tg_table_name,
                 'schema', tg_table_schema,
                 'record', to_jsonb(new)
               )
  );
  return new;
exception when others then
  return new;  -- notifications are best-effort; never fail the insert
end
$$;

-- One trigger per table, all sharing notify_author().
drop trigger if exists notify_on_comment on public.comments;
create trigger notify_on_comment after insert on public.comments
  for each row execute function public.notify_author();

drop trigger if exists notify_on_highlight_comment on public.highlight_comments;
create trigger notify_on_highlight_comment after insert on public.highlight_comments
  for each row execute function public.notify_author();

drop trigger if exists notify_on_highlight on public.highlights;
create trigger notify_on_highlight after insert on public.highlights
  for each row execute function public.notify_author();

drop trigger if exists notify_on_note on public.notes;
create trigger notify_on_note after insert on public.notes
  for each row execute function public.notify_author();

drop trigger if exists notify_on_feedback on public.feedback;
create trigger notify_on_feedback after insert on public.feedback
  for each row execute function public.notify_author();

-- upvotes on a comment or a highlight-discussion reply (the endpoint resolves the
-- target row to name the post/author, and skips a reader upvoting their own comment)
drop trigger if exists notify_on_vote on public.votes;
create trigger notify_on_vote after insert on public.votes
  for each row execute function public.notify_author();
