/**
 * /api/admin/comments — comment moderation (admin-gated).
 *   GET    [?post=<slug>] [?limit=n]  → recent comments across posts (or one post)
 *   DELETE ?id=<uuid>                 → remove a comment
 *
 * WHY SERVICE ROLE: public.comments has a public SELECT but NO admin/moderator
 * policy and no UPDATE/DELETE for others' rows, so moderation is impossible via
 * the anon client. This endpoint uses the service-role key (which bypasses RLS)
 * behind the admin gate — the only correct way to list-with-author and delete
 * arbitrary comments.
 */
import { requireAdmin, json } from '../../../lib/require-admin.js';

export async function onRequestGet({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (!gate.ok) return json({ error: gate.error }, gate.status);

  const sb = env.SUPABASE_URL;
  const service = env.SUPABASE_SERVICE_ROLE_KEY;
  const url = new URL(request.url);
  const post = url.searchParams.get('post');
  const limit = Math.min(300, Math.max(1, parseInt(url.searchParams.get('limit') || '150', 10) || 150));

  const params = ['select=id,post_id,author_name,body,created_at,user_id', 'order=created_at.desc'];
  if (post) params.push(`post_id=eq.${encodeURIComponent(post)}`);
  let rows = [];
  try {
    const r = await fetch(`${sb}/rest/v1/comments?${params.join('&')}`, {
      headers: { Authorization: `Bearer ${service}`, apikey: service, Range: `0-${limit - 1}` },
    });
    if (r.ok) rows = await r.json();
  } catch {
    /* empty on failure */
  }
  return json({ rows });
}

export async function onRequestDelete({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (!gate.ok) return json({ error: gate.error }, gate.status);

  const sb = env.SUPABASE_URL;
  const service = env.SUPABASE_SERVICE_ROLE_KEY;
  const id = new URL(request.url).searchParams.get('id') || '';
  // Comment ids are UUIDs; validate shape before interpolating into the filter.
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'Invalid id' }, 400);

  const r = await fetch(`${sb}/rest/v1/comments?id=eq.${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${service}`, apikey: service, Prefer: 'return=minimal' },
  });
  if (!r.ok) return json({ error: 'Delete failed', detail: (await r.text()).slice(0, 200) }, 502);
  return json({ ok: true, id });
}
