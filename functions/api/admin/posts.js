/**
 * GET /api/admin/posts — the live post catalog for the dashboard's Posts manager.
 * Admin-gated. Returns every post (drafts included) from the git content
 * collection, enriched with live paywall state (Supabase post_paywall) and a flag
 * for whether the instant KV overlay is currently serving it. See lib/list-posts.js.
 */
import { requireAdmin, json } from '../../../lib/require-admin.js';
import { listPosts } from '../../../lib/list-posts.js';

export async function onRequestGet({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (!gate.ok) return json({ error: gate.error }, gate.status);

  let posts;
  try {
    posts = await listPosts(env);
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 502);
  }

  // Live paywall state. post_paywall is public-readable, but we use the service
  // role here for one consistent code path (requireAdmin already proved config).
  const paywall = {};
  try {
    const sb = env.SUPABASE_URL;
    const service = env.SUPABASE_SERVICE_ROLE_KEY;
    if (sb && service) {
      const r = await fetch(`${sb}/rest/v1/post_paywall?select=post_id,is_paid,price_cents,currency,product_id`, {
        headers: { Authorization: `Bearer ${service}`, apikey: service },
      });
      if (r.ok) for (const row of await r.json()) paywall[row.post_id] = row;
    }
  } catch {
    /* paywall annotation is best-effort */
  }

  // Slugs the instant overlay is serving right now (published but not yet rebuilt).
  let instant = [];
  try {
    if (env.POSTS_HTML) {
      const idxRaw = await env.POSTS_HTML.get('__index');
      const idx = idxRaw ? JSON.parse(idxRaw) : [];
      if (Array.isArray(idx)) instant = idx.map((p) => p && p.slug).filter(Boolean);
    }
  } catch {
    /* instant markers are best-effort */
  }

  // Which posts have already been emailed to subscribers. The broadcast guard
  // (functions/api/admin/broadcast.js) stores a `broadcast:<slug>` KV key whose
  // metadata carries the send status, so one list() call reads every post's state
  // with no per-post get(). Legacy keys (written before metadata) have no metadata
  // — a lingering key means a completed send (the transient 'sending' reservation
  // gets metadata; a total failure deletes the key), so treat missing metadata as sent.
  const broadcasts = {};
  try {
    if (env.POSTS_HTML) {
      let cursor;
      do {
        const l = await env.POSTS_HTML.list({ prefix: 'broadcast:', cursor });
        for (const k of l.keys || []) {
          broadcasts[k.name.slice('broadcast:'.length)] = k.metadata || {};
        }
        cursor = l.list_complete ? null : l.cursor;
      } while (cursor);
    }
  } catch {
    /* email-state markers are best-effort */
  }

  const enriched = posts.map((p) => {
    const pw = paywall[p.slug];
    const bc = broadcasts[p.slug];
    return {
      ...p,
      paid: pw ? pw.is_paid === true : false,
      priceCents: pw ? pw.price_cents : null,
      currency: pw ? pw.currency : null,
      productId: pw ? pw.product_id || '' : '',
      hasProduct: pw ? Boolean(pw.product_id) : false,
      instant: instant.includes(p.slug),
      // emailed: a present key with status !== 'sending' (or a legacy key with no
      // metadata) counts as sent; a mid-flight 'sending' reservation does not.
      emailed: bc ? bc.status !== 'sending' : false,
      emailedAt: bc && bc.sentAt ? bc.sentAt : null,
      // failed recipient count from the last send (for a targeted "retry failed").
      emailedFailed: bc && typeof bc.failed === 'number' ? bc.failed : 0,
    };
  });

  return json({ posts: enriched });
}
