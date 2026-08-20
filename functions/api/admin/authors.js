/**
 * /api/admin/authors — owner-only author roster + invite + role/publish/status controls.
 * ============================================================================
 * GET    → { authors: [{ id, email, handle, pen_name, role, can_publish, status, onboarded, published }] }
 * POST   { email, role? }              → invite → { ok, email, role, link }  (link is the sign-in
 *          invite URL; we do NOT auto-send email — the owner shares the link, so no accidental sends)
 * PATCH  { user_id, role?, can_publish?, status? } → update → { ok }
 *
 * Owner-gated (requireAdmin ⇒ is_owner). The real work runs in public SECURITY DEFINER wrappers
 * (db/authors-admin.sql) that re-check is_owner and are granted to the service role only, so this
 * Function — holding the service key, caller proven an owner — is the sole caller. An invited author
 * is provisioned with NO @handle (handle is permanent, claimed by them at onboarding).
 *
 * ENV: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */
import { requireAdmin, json } from '../../../lib/require-admin.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Call a public Postgres function via PostgREST with the service key. Never throws.
async function rpc(env, fn, args) {
  const sb = env.SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const r = await fetch(`${sb}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args || {}),
      signal: AbortSignal.timeout(8000),
    });
    const text = await r.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
    return { ok: r.ok, status: r.status, data };
  } catch { return { ok: false, status: 0, data: null }; }
}

// Supabase Auth admin API. Never throws.
async function authAdmin(env, path, method, body) {
  const sb = env.SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const r = await fetch(`${sb}/auth/v1/${path}`, {
      method,
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(8000),
    });
    const text = await r.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
    return { ok: r.ok, status: r.status, data };
  } catch { return { ok: false, status: 0, data: null }; }
}

// A sign-in link for `email`, creating the user if new. generate_link returns the FULL user for
// that exact email (top-level id), so we never guess who it is. 'invite' creates + links a new
// user; if they already exist it errors, so we fall back to 'magiclink' (also returns their id).
// Neither sends an email. Returns { id, link } or null.
async function linkFor(env, email) {
  let r = await authAdmin(env, 'admin/generate_link', 'POST', { type: 'invite', email });
  if (!r.ok || !r.data || !r.data.id) {
    r = await authAdmin(env, 'admin/generate_link', 'POST', { type: 'magiclink', email });
  }
  if (!r.ok || !r.data || !r.data.id) return null;
  return { id: r.data.id, link: r.data.action_link || null };
}

export async function onRequest({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (!gate.ok) return json({ error: gate.error }, gate.status);
  const owner = gate.userId;
  const method = request.method;

  if (method === 'GET') {
    const r = await rpc(env, 'list_authors', { p_caller: owner });
    if (!r.ok) return json({ error: 'Could not load authors' }, 502);
    return json({ authors: Array.isArray(r.data) ? r.data : [] });
  }

  if (method === 'POST') {
    let body = {}; try { body = await request.json(); } catch { /* empty */ }
    const email = String(body.email || '').trim().toLowerCase();
    const role = body.role === 'editor' ? 'editor' : 'author';
    if (!EMAIL_RE.test(email)) return json({ error: 'Enter a valid email address.' }, 400);

    // Resolve/create the exact user for this email + a sign-in link (no email sent).
    const u = await linkFor(env, email);
    if (!u) return json({ error: 'Could not create the invite.' }, 502);

    const prov = await rpc(env, 'owner_invite_author', { p_caller: owner, p_user_id: u.id, p_role: role });
    if (!prov.ok) return json({ error: 'Could not add the author.' }, 502);
    return json({ ok: true, email, role, link: u.link });
  }

  if (method === 'PATCH') {
    let body = {}; try { body = await request.json(); } catch { /* empty */ }
    const uid = String(body.user_id || '');
    if (!uid) return json({ error: 'Missing user_id.' }, 400);
    const done = {};
    if (typeof body.role === 'string') {
      const r = await rpc(env, 'owner_set_role', { p_caller: owner, p_user_id: uid, p_role: body.role });
      if (!r.ok) return json({ error: 'Could not change the role.' }, 502);
      done.role = body.role;
    }
    if (typeof body.can_publish === 'boolean') {
      const r = await rpc(env, 'owner_set_can_publish', { p_caller: owner, p_user_id: uid, p_value: body.can_publish });
      if (!r.ok) return json({ error: 'Could not change publishing.' }, 502);
      done.can_publish = body.can_publish;
    }
    if (typeof body.status === 'string') {
      const r = await rpc(env, 'owner_set_status', { p_caller: owner, p_user_id: uid, p_status: body.status });
      if (!r.ok) return json({ error: 'Could not change the status.' }, 502);
      done.status = body.status;
    }
    return json({ ok: true, ...done });
  }

  return json({ error: 'Method not allowed' }, 405);
}
