/**
 * /api/admin/admins — manage who can access the Studio, by email.
 * ============================================================================
 * GET    → { admins: [{ email, userId, createdAt, self }], self:{email,userId} }
 *          (or { setup:true } if db/admins-manage.sql hasn't been run yet)
 * POST   { email }  → grant admin      → { ok, status, message, admins }
 * DELETE { email }  → revoke admin     → { ok, status, message, admins }
 *
 * Admin-gated (requireAdmin): only an existing admin may view or change the set.
 * The real work runs in three SECURITY DEFINER SQL helpers (db/admins-manage.sql)
 * that resolve email↔user via auth.users and write public.admins; they're granted
 * to the service role ONLY, so this Function — which holds the service key and has
 * already proven the caller is an admin — is the sole caller. The SQL refuses to
 * remove the last admin, so the Studio can never lock itself out.
 *
 * ENV: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */
import { requireAdmin, json } from '../../../lib/require-admin.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Call a Postgres function via PostgREST RPC with the service-role key.
// Returns { ok, status, data } — data is the parsed body (scalar or array).
// A timeout/network error is caught and normalized to { ok:false, status:0 } so it
// never throws out of the handler (which Cloudflare would mask with an opaque 5xx).
async function rpc(env, fn, args) {
  const sb = env.SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const r = await fetch(`${sb}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, apikey: key, 'content-type': 'application/json' },
      body: JSON.stringify(args || {}),
      signal: AbortSignal.timeout(8000),
    });
    let data = null;
    try { data = await r.json(); } catch { /* empty/non-json body */ }
    return { ok: r.ok, status: r.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

// Shape admin_list() rows for the client, flagging the caller's own row.
function shapeList(rows, selfId) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => ({
    email: row.email || '',
    userId: row.user_id,
    createdAt: row.created_at || null,
    self: row.user_id === selfId,
  }));
}

async function listOr(env, selfId) {
  const res = await rpc(env, 'admin_list', {});
  if (res.ok) return { admins: shapeList(res.data, selfId) };
  // Function missing (migration not run yet) → tell the UI to prompt for setup.
  if (res.status === 404) return { setup: true };
  return { error: true };
}

export async function onRequestGet({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (!gate.ok) return json({ error: gate.error }, gate.status);
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Server not configured' }, 500);

  const out = await listOr(env, gate.userId);
  if (out.setup) return json({ admins: [], setup: true, self: { email: gate.user?.email || '', userId: gate.userId } });
  // 424 (a 4xx), not 5xx: Cloudflare masks a Function's 5xx body with its own error
  // page, which would swallow this JSON message (see cloudflare-5xx-masking rule).
  if (out.error) return json({ error: 'Could not load admins right now.' }, 424);
  return json({ admins: out.admins, self: { email: gate.user?.email || '', userId: gate.userId } });
}

// Email comes from the JSON body ONLY — never a query param, so an admin's email
// (PII) is never written into the request URL / access logs.
async function readEmail(request) {
  let body = {};
  try { body = await request.json(); } catch { /* missing/invalid body → '' → 400 */ }
  return String((body && body.email) || '').trim();
}

export async function onRequestPost({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (!gate.ok) return json({ error: gate.error }, gate.status);
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Server not configured' }, 500);

  const email = await readEmail(request);
  if (!EMAIL_RE.test(email)) return json({ ok: false, error: 'Enter a valid email address.' }, 400);

  const res = await rpc(env, 'admin_add_by_email', { p_email: email, p_actor: gate.userId });
  if (!res.ok) {
    if (res.status === 404) return json({ ok: false, error: 'Setup needed — run db/admins-manage.sql in Supabase.', setup: true }, 400);
    return json({ ok: false, error: 'Could not add that admin right now.' }, 424); // 4xx so the body survives Cloudflare
  }
  const status = res.data; // 'added' | 'already' | 'no_user'
  if (status === 'no_user') {
    return json({ ok: false, status, error: `No account exists for ${email} yet — ask them to sign in once, then add them.` }, 404);
  }
  const list = await listOr(env, gate.userId);
  const message = status === 'already' ? `${email} is already an admin.` : `Added ${email} as an admin.`;
  const resp = { ok: true, status, message };
  // Only send the refreshed list when it actually loaded — otherwise omit it so the
  // client keeps its current rows instead of flashing "No admins yet" under a success.
  if (Array.isArray(list.admins)) resp.admins = list.admins;
  return json(resp);
}

export async function onRequestDelete({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (!gate.ok) return json({ error: gate.error }, gate.status);
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Server not configured' }, 500);

  const email = await readEmail(request);
  if (!EMAIL_RE.test(email)) return json({ ok: false, error: 'Enter a valid email address.' }, 400);

  const res = await rpc(env, 'admin_remove_by_email', { p_email: email });
  if (!res.ok) {
    if (res.status === 404) return json({ ok: false, error: 'Setup needed — run db/admins-manage.sql in Supabase.', setup: true }, 400);
    return json({ ok: false, error: 'Could not remove that admin right now.' }, 424); // 4xx so the body survives Cloudflare
  }
  const status = res.data; // 'removed' | 'not_admin' | 'no_user' | 'last_admin'
  if (status === 'last_admin') return json({ ok: false, status, error: 'Can’t remove the last admin — add another admin first.' }, 409);
  if (status === 'not_admin') return json({ ok: false, status, error: `${email} isn’t an admin.` }, 404);
  if (status === 'no_user') return json({ ok: false, status, error: `No account exists for ${email}.` }, 404);
  const list = await listOr(env, gate.userId);
  const resp = { ok: true, status, message: `Removed ${email}.` };
  if (Array.isArray(list.admins)) resp.admins = list.admins;
  return json(resp);
}
