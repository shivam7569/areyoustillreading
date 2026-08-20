/**
 * lib/require-author.js — the server-side AUTHOR trust boundary.
 * ============================================================================
 * The author-side sibling of lib/require-admin.js. Answers, fail-closed: "is the
 * caller a signed-in ACTIVE AUTHOR (or the owner)?" Used by every /api/author/*
 * endpoint before it touches content.* through the service-role RPCs.
 *
 * HOW IT DECIDES
 *   1) Validate the Supabase access token (`Authorization: Bearer <jwt>`) via
 *      Supabase `/auth/v1/user` — never decoded here (same as require-admin).
 *   2) Resolve the caller's role by calling `public.my_profile()` WITH THE CALLER'S
 *      OWN TOKEN (authenticated) — the RPC is auth.uid()-scoped, so it returns the
 *      caller's row. Active author = role in (author,editor) AND status='active'.
 *      content.* is unexposed to PostgREST, but my_profile lives in the exposed
 *      `public` schema, so this works without exposing the content schema.
 *   3) The OWNER may always author: if the profile check fails, fall back to the
 *      public.admins lookup (service-role), matching save_post/publish_post which
 *      accept `is_active_author(caller) OR is_owner(caller)`.
 *
 * CONTRACT
 *   requireAuthor(request, env) -> Promise<
 *       | { ok: true,  userId: string, role: 'author'|'editor'|'owner', profile?: object }
 *       | { ok: false, status: number, error: string }>
 *   Fails CLOSED on any ambiguity (missing env, bad token, upstream hiccup).
 *
 * ENV: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (+ an anon key for the authenticated
 *   RPC call: PUBLIC_SUPABASE_ANON_KEY | SUPABASE_ANON_KEY, falling back to service).
 */

export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

/**
 * Call a PUBLIC-schema RPC with the SERVICE-ROLE key (the author write RPCs are
 * granted to service_role only). Returns { ok, status, data }. The caller has already
 * been authorized by requireAuthor; the validated userId is passed as the RPC's p_caller.
 * A Postgres RAISE surfaces as a non-2xx with a { message } body → propagate its text.
 */
export async function svcRpc(env, fn, args) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify(args || {}),
  });
  const text = await r.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: r.ok, status: r.status, data };
}

/**
 * Turn a failed svcRpc result into a JSON error Response. A Postgres RAISE (business
 * rule) is mapped to a 4xx so Cloudflare doesn't mask it as its own "Bad gateway" 5xx
 * (see the Cloudflare-5xx-masking gotcha); genuine infra failures pass through as 502.
 */
export function rpcError(r) {
  const msg = (r && r.data && (r.data.message || r.data.error)) || 'Request failed';
  let status = 400;
  if (/not authoriz|not an author|not permitted|permission denied/i.test(msg)) status = 403;
  else if (/not found/i.test(msg)) status = 404;
  else if (r && r.status >= 500 && !(r.data && r.data.message)) status = 502; // no PG message → real upstream failure
  return json({ error: msg }, status);
}

export async function requireAuthor(request, env) {
  const sb = env.SUPABASE_URL;
  const service = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sb || !service) return { ok: false, status: 500, error: 'Server not configured (Supabase)' };
  const anon = env.PUBLIC_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || service;

  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return { ok: false, status: 401, error: 'Not signed in' };

  // 1) Validate the token → resolve the user (delegated to Supabase; never decoded here).
  let user;
  try {
    const r = await fetch(`${sb}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: service } });
    if (!r.ok) {
      if (r.status >= 500) return { ok: false, status: 502, error: 'Could not verify session' };
      return { ok: false, status: 401, error: 'Session expired — sign in again' };
    }
    user = await r.json();
  } catch {
    return { ok: false, status: 502, error: 'Could not verify session' };
  }
  if (!user || !user.id) return { ok: false, status: 401, error: 'Session expired — sign in again' };

  // 2) Active-author? Ask public.my_profile() with the CALLER'S token (auth.uid()-scoped).
  try {
    const r = await fetch(`${sb}/rest/v1/rpc/my_profile`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, apikey: anon, 'content-type': 'application/json' },
      body: '{}',
    });
    if (r.ok) {
      const rows = await r.json();
      const p = Array.isArray(rows) ? rows[0] : rows;
      if (p && (p.role === 'author' || p.role === 'editor') && p.status === 'active') {
        return { ok: true, userId: user.id, role: p.role, profile: p };
      }
    }
    // a non-OK my_profile is not fatal — the owner fallback below still applies
  } catch {
    /* fall through to the owner check */
  }

  // 3) Owner fallback (public.admins has no RLS select → service-role lookup).
  try {
    const r = await fetch(`${sb}/rest/v1/admins?select=user_id&user_id=eq.${encodeURIComponent(user.id)}`, {
      headers: { Authorization: `Bearer ${service}`, apikey: service },
    });
    if (!r.ok) return { ok: false, status: 502, error: 'Could not verify authorization' };
    const admins = await r.json();
    if (Array.isArray(admins) && admins.length) return { ok: true, userId: user.id, role: 'owner', profile: null };
  } catch {
    return { ok: false, status: 502, error: 'Could not verify authorization' };
  }

  return { ok: false, status: 403, error: 'Not an author' };
}
