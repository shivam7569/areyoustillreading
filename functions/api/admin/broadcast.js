/**
 * POST /api/admin/broadcast — email a "new post" announcement to every CONFIRMED
 * newsletter subscriber. Admin-gated. The FILE-post path (owner editor → /api/publish
 * → here). Announces an already-published /blog/<slug> post.
 * =============================================================================
 * This is now a thin, admin-gated wrapper over the shared send engine lib/broadcast.js
 * (which both this and the DB author-publish path reuse). The engine holds the full
 * idempotency + fail-closed + per-recipient one-click-unsubscribe rationale. This file's
 * only job: verify admin, validate the file slug, and hand the engine the file-post
 * postUrl (/blog/<slug>/) and guard key (broadcast:<slug>).
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, POSTS_HTML (KV guard),
 *      SITE_URL, EMAIL_FROM, MAIL_ADDRESS — see lib/broadcast.js.
 */
import { requireAdmin, json } from '../../../lib/require-admin.js';
import { broadcastPost } from '../../../lib/broadcast.js';

export async function onRequestPost(ctx) {
  try {
    return await handle(ctx);
  } catch (e) {
    // 4xx (never a 5xx Cloudflare would mask) so the editor sees the real reason.
    return json({ error: 'Broadcast failed: ' + String((e && e.message) || e) }, 400);
  }
}

async function handle({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (!gate.ok) return json({ error: gate.error }, gate.status);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const { slug, title, description, force, retry } = body || {};
  if (typeof slug !== 'string' || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug)) return json({ error: 'Invalid slug' }, 400);

  const site = (env.SITE_URL || 'https://areyoustillreading.dev').replace(/\/+$/, '');
  const r = await broadcastPost(env, {
    postUrl: `${site}/blog/${slug}/`,
    guardKey: `broadcast:${slug}`,
    title, description, force: force === true, retry: retry === true,
  });
  return json(r.body, r.status);
}
