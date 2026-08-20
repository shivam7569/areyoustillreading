/*
 * /api/author/publish — publish (or unpublish) an AUTHOR's own DB post.
 * ============================================================================
 * The trust boundary for going live from the database. Gated by requireAuthor; the
 * body_html is rendered + sanitized in the browser (the shared markdownConfig pipeline),
 * and this endpoint adds a fail-closed INERT-GUARD backstop (lib/inert-guard.js) before
 * committing it via public.author_publish → content.publish_post (service-role, which
 * re-checks ownership + can_publish). A DB publish is synchronous: on success the post
 * is already served live by the /@handle/slug edge middleware — no rebuild, no KV.
 *
 *   POST { post_id, body_html, body_text, reading_min }            -> { ok, url, slug, handle }
 *   POST { post_id, unpublish: 'unpublish'|'archive'|'unlist' }    -> { ok, status }
 */
import { requireAuthor, svcRpc, rpcError, json } from '../../../lib/require-author.js';
import { assertInert, InertError } from '../../../lib/inert-guard.js';
import { broadcastPost } from '../../../lib/broadcast.js';

export async function onRequestPost({ request, env }) {
  const gate = await requireAuthor(request, env);
  if (!gate.ok) return json({ error: gate.error }, gate.status);

  let p;
  try { p = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const { post_id, body_html, body_text, reading_min, unpublish } = p || {};
  if (!post_id || typeof post_id !== 'string') return json({ error: 'Missing post_id' }, 400);

  // Unpublish / archive / unlist — no body to vet.
  if (unpublish) {
    const op = ['unpublish', 'archive', 'unlist'].includes(unpublish) ? unpublish : 'unpublish';
    const r = await svcRpc(env, 'author_unpublish', { p_caller: gate.userId, p_post_id: post_id, p_op: op });
    if (!r.ok) return rpcError(r);
    const row = Array.isArray(r.data) ? r.data[0] : r.data;
    return json({ ok: true, status: row && row.status });
  }

  // Publish: the body_html must be a non-empty, INERT document (backstop for a POST
  // that bypassed the editor's in-pipeline sanitize).
  if (typeof body_html !== 'string' || !body_html.trim()) return json({ error: 'Missing body_html' }, 400);
  try {
    assertInert(body_html);
  } catch (e) {
    if (e instanceof InertError) return json({ error: 'Rejected: ' + e.message }, 422);
    return json({ error: 'Could not vet content' }, 400);
  }

  // Schedule (a future publish) instead of going live now — stores the vetted body + status
  // 'scheduled' + publish_at; the cron (scripts/flip-scheduled-db.mjs) flips it live when due.
  if (typeof p.schedule === 'string' && p.schedule) {
    const sr = await svcRpc(env, 'author_schedule_post', {
      p_caller: gate.userId, p_post_id: post_id, p_body_html: body_html,
      p_body_text: typeof body_text === 'string' ? body_text : '',
      p_reading_min: Number.isFinite(reading_min) ? Math.max(1, Math.round(reading_min)) : null,
      p_publish_at: p.schedule,
    });
    if (!sr.ok) return rpcError(sr);
    const row = Array.isArray(sr.data) ? sr.data[0] : sr.data;
    if (!row || !row.slug || !row.handle) return json({ error: 'Schedule returned no location' }, 502);
    return json({ ok: true, scheduled: true, publish_at: row.publish_at, slug: row.slug, handle: row.handle, url: `/@${row.handle}/${row.slug}` });
  }

  const r = await svcRpc(env, 'author_publish', {
    p_caller: gate.userId,
    p_post_id: post_id,
    p_body_html: body_html,
    p_body_text: typeof body_text === 'string' ? body_text : '',
    p_reading_min: Number.isFinite(reading_min) ? Math.max(1, Math.round(reading_min)) : null,
  });
  if (!r.ok) return rpcError(r);
  const row = Array.isArray(r.data) ? r.data[0] : r.data;
  if (!row || !row.slug || !row.handle) return json({ error: 'Publish returned no location' }, 502);

  // Optionally announce to confirmed subscribers (opt-in; best-effort — a mail failure
  // never fails the publish). The post is already live. Guard by the post UUID (a DB slug
  // is unique only per author); the email links to the canonical /@handle/slug.
  let email = null;
  if (p.email === true) {
    try {
      const site = (env.SITE_URL || 'https://areyoustillreading.dev').replace(/\/+$/, '');
      const br = await broadcastPost(env, {
        postUrl: `${site}/@${row.handle}/${row.slug}`,
        guardKey: `broadcast:${post_id}`,
        title: typeof p.title === 'string' && p.title.trim() ? p.title : row.slug,
        description: typeof p.description === 'string' ? p.description : '',
      });
      email = br.body;
    } catch (e) {
      email = { error: String((e && e.message) || e) };
    }
  }
  return json({ ok: true, slug: row.slug, handle: row.handle, url: `/@${row.handle}/${row.slug}`, status: row.status, email });
}
