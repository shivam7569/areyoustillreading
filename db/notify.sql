-- =============================================================================
-- db/notify.sql — author email notifications for every new reader interaction.
-- -----------------------------------------------------------------------------
-- Creates one AFTER INSERT webhook per interaction table, all POSTing the new row
-- to /api/notify (functions/api/notify.js), which emails the author via Resend.
-- Server-authoritative: fires on the real DB write, independent of the reader's
-- browser. Covers comments, highlight discussions, highlights, private notes, and
-- "Did it hold?" feedback (the poll upserts, so AFTER INSERT fires once per reader).
--
-- ── ONE-TIME SETUP ──────────────────────────────────────────────────────────
-- 1. Enable Database Webhooks once: Supabase dashboard → Database → Webhooks →
--    "Enable webhooks" (this provisions the supabase_functions schema used below).
-- 2. Pick a long random secret. Set it in BOTH places, identical:
--      • Cloudflare Pages → Settings → Variables:  NOTIFY_SECRET = <secret>
--      • the REPLACE_WITH_NOTIFY_SECRET placeholders below
-- 3. Also set in Cloudflare Pages:  AUTHOR_EMAIL = you@yourdomain  (where notices go)
--    (RESEND_API_KEY / EMAIL_FROM / SITE_URL are already configured for the letter.)
-- 4. Run this file in the Supabase SQL editor. Re-runnable (drop-then-create).
--
-- To STOP notifications: drop the triggers (the DROPs below leave you clean), or
-- unset AUTHOR_EMAIL / NOTIFY_SECRET (the endpoint then silently no-ops).
-- =============================================================================

-- The apex endpoint + the shared secret header. Keep the URL on your production host.
-- supabase_functions.http_request auto-sends the { type, table, record, schema } body.

do $$ begin
  -- comments (top-level + replies; replies carry parent_id)
  drop trigger if exists notify_on_comment on public.comments;
  create trigger notify_on_comment after insert on public.comments
    for each row execute function supabase_functions.http_request(
      'https://areyoustillreading.dev/api/notify', 'POST',
      '{"Content-Type":"application/json","x-notify-secret":"REPLACE_WITH_NOTIFY_SECRET"}',
      '{}', '5000');

  -- highlight discussions (reader ↔ author replies on a highlight)
  drop trigger if exists notify_on_highlight_comment on public.highlight_comments;
  create trigger notify_on_highlight_comment after insert on public.highlight_comments
    for each row execute function supabase_functions.http_request(
      'https://areyoustillreading.dev/api/notify', 'POST',
      '{"Content-Type":"application/json","x-notify-secret":"REPLACE_WITH_NOTIFY_SECRET"}',
      '{}', '5000');

  -- highlights
  drop trigger if exists notify_on_highlight on public.highlights;
  create trigger notify_on_highlight after insert on public.highlights
    for each row execute function supabase_functions.http_request(
      'https://areyoustillreading.dev/api/notify', 'POST',
      '{"Content-Type":"application/json","x-notify-secret":"REPLACE_WITH_NOTIFY_SECRET"}',
      '{}', '5000');

  -- private notes
  drop trigger if exists notify_on_note on public.notes;
  create trigger notify_on_note after insert on public.notes
    for each row execute function supabase_functions.http_request(
      'https://areyoustillreading.dev/api/notify', 'POST',
      '{"Content-Type":"application/json","x-notify-secret":"REPLACE_WITH_NOTIFY_SECRET"}',
      '{}', '5000');

  -- "Did it hold?" feedback (first answer per reader/post — upsert = INSERT once)
  drop trigger if exists notify_on_feedback on public.feedback;
  create trigger notify_on_feedback after insert on public.feedback
    for each row execute function supabase_functions.http_request(
      'https://areyoustillreading.dev/api/notify', 'POST',
      '{"Content-Type":"application/json","x-notify-secret":"REPLACE_WITH_NOTIFY_SECRET"}',
      '{}', '5000');
end $$;
