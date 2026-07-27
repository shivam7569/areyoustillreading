/**
 * GET /api/admin/subscribers — the audience list + status counts for the
 * dashboard's Audience section. Admin-gated. Reads public.subscribers with the
 * service-role key (the table is RLS-locked deny-all to the anon key). NEVER
 * selects the confirm/unsubscribe tokens — those are secrets and stay server-side.
 *
 * Query params: ?status=confirmed|pending|unsubscribed  ?q=<email substring>
 *               ?limit=<1..200>  ?offset=<n>
 */
import { requireAdmin, json } from '../../../lib/require-admin.js';

export async function onRequestGet({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (!gate.ok) return json({ error: gate.error }, gate.status);

  const sb = env.SUPABASE_URL;
  const service = env.SUPABASE_SERVICE_ROLE_KEY;
  const auth = { Authorization: `Bearer ${service}`, apikey: service };
  const base = `${sb}/rest/v1/subscribers`;

  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const q = (url.searchParams.get('q') || '').trim();
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') || '100', 10) || 100));
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);

  // Exact counts via PostgREST's count=exact (total lives in the Content-Range header).
  async function count(filter) {
    try {
      const r = await fetch(`${base}?select=id${filter ? `&${filter}` : ''}`, {
        headers: { ...auth, Prefer: 'count=exact', Range: '0-0' },
      });
      const m = /\/(\d+)\s*$/.exec(r.headers.get('content-range') || '');
      return m ? parseInt(m[1], 10) : 0;
    } catch {
      return 0;
    }
  }
  const [total, confirmed, pending, unsubscribed] = await Promise.all([
    count(''),
    count('status=eq.confirmed'),
    count('status=eq.pending'),
    count('status=eq.unsubscribed'),
  ]);

  // A page of rows (safe columns only; never the tokens).
  const params = ['select=id,email,status,created_at,confirmed_at,last_email_at', 'order=created_at.desc'];
  if (status) params.push(`status=eq.${encodeURIComponent(status)}`);
  if (q) params.push(`email=ilike.*${encodeURIComponent(q)}*`);
  let rows = [];
  try {
    const listRes = await fetch(`${base}?${params.join('&')}`, {
      headers: { ...auth, Range: `${offset}-${offset + limit - 1}` },
    });
    if (listRes.ok) rows = await listRes.json();
  } catch {
    /* fall through with empty rows */
  }

  return json({ counts: { total, confirmed, pending, unsubscribed }, rows, offset, limit });
}
