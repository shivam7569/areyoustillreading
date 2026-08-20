/**
 * scripts/flip-scheduled-db.mjs — flip every DUE scheduled DB post to published.
 *
 * The DB counterpart of publish-scheduled.mjs (which flips file posts + commits). A
 * scheduled DB post already stores its rendered body_html (author_schedule_post), so
 * going live is just a status flip — INSTANT, no rebuild: the reader's /@handle/slug
 * middleware serves from the DB. Run on the same cron (.github/workflows/scheduled-publish.yml).
 *
 * Dependency-free: uses fetch (Node 20+) + the service-role PostgREST RPC, so the workflow
 * needs no npm install — only SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in its env.
 */
const SB = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB || !KEY) {
  console.error('flip-scheduled-db: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — skipping DB flip.');
  process.exit(0); // don't fail the cron job; the file flip step still runs
}
const r = await fetch(`${SB}/rest/v1/rpc/flip_scheduled_posts`, {
  method: 'POST',
  headers: { apikey: KEY, authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
  body: '{}',
});
if (!r.ok) {
  console.error('flip-scheduled-db: RPC failed', r.status, (await r.text()).slice(0, 300));
  process.exit(1);
}
console.log(`flip-scheduled-db: ${(await r.text()).trim()} scheduled DB post(s) now live`);
