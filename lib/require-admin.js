/**
 * lib/require-admin.js — the ONE server-side admin trust boundary.
 * ============================================================================
 * WHAT THIS IS
 *   A shared helper for Cloudflare Pages Functions that answers a single
 *   question, authoritatively and fail-closed: "is the caller of this request a
 *   signed-in site admin?" It validates the Supabase access token the client
 *   sends as `Authorization: Bearer <jwt>` and confirms the resolved user has a
 *   row in public.admins (looked up with the service-role key, since that table
 *   has no RLS SELECT policy and is not readable by ordinary clients).
 *
 * WHY IT EXISTS
 *   Every admin action on the site (publishing a post, listing subscribers,
 *   moderating comments, reading the sales ledger, …) must independently
 *   re-verify admin server-side — the client `is_admin()` check only toggles UI
 *   and grants zero authority. This exact preamble first lived inlined in
 *   functions/api/publish.js and functions/gated/_middleware.js; duplicating it
 *   per endpoint is how gates drift. This module is the single copy every admin
 *   endpoint imports, so the boundary is identical everywhere.
 *
 * CONTRACT
 *   requireAdmin(request, env) -> Promise<
 *       | { ok: true,  userId: string, user: object }
 *       | { ok: false, status: number, error: string }>
 *   Never throws for the expected failure paths (missing config, no token, bad
 *   token, not an admin, upstream hiccup) — it returns { ok:false } with the
 *   status/message the caller should send back. It fails CLOSED: any ambiguity
 *   (missing env, network error talking to Supabase) denies access.
 *
 * USAGE (every admin Function)
 *   import { requireAdmin, json } from '../../../lib/require-admin.js';
 *   const gate = await requireAdmin(request, env);
 *   if (!gate.ok) return json({ error: gate.error }, gate.status);
 *   // …gate.userId is a trusted admin from here on…
 *
 * ENV (Pages project → Bindings, BOTH Production and Preview):
 *   SUPABASE_URL              — Supabase project base URL
 *   SUPABASE_SERVICE_ROLE_KEY — service role (validates token, reads public.admins)
 * ============================================================================
 */

/** JSON Response helper — every admin endpoint's success and error paths use it
 *  so callers always receive `application/json`. */
export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * Verify the request carries a valid Supabase session belonging to an admin.
 * @param {Request} request  the incoming Function request (reads Authorization)
 * @param {Record<string, any>} env  the Function env (Supabase URL + service key)
 * @returns {Promise<{ ok: true, userId: string, user: any } | { ok: false, status: number, error: string }>}
 */
export async function requireAdmin(request, env) {
  const sb = env.SUPABASE_URL;
  const service = env.SUPABASE_SERVICE_ROLE_KEY;
  // Missing server config can never be treated as "allow" — deny with 500.
  if (!sb || !service) return { ok: false, status: 500, error: 'Server not configured (Supabase)' };

  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return { ok: false, status: 401, error: 'Not signed in' };

  // 1) Validate the token → resolve the user. Delegated to Supabase; never decoded
  //    here, so we never trust client-supplied identity. Network failure => 502.
  let userRes;
  try {
    userRes = await fetch(`${sb}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: service },
    });
  } catch {
    return { ok: false, status: 502, error: 'Could not verify session' };
  }
  if (!userRes.ok) return { ok: false, status: 401, error: 'Session expired — sign in again' };
  const user = await userRes.json();
  if (!user || !user.id) return { ok: false, status: 401, error: 'Session expired — sign in again' };

  // 2) Is this user the site owner? public.admins has no RLS select policy, so this
  //    lookup uses the SERVICE-ROLE key. Empty result => not an admin => 403.
  let adminRes;
  try {
    adminRes = await fetch(`${sb}/rest/v1/admins?select=user_id&user_id=eq.${encodeURIComponent(user.id)}`, {
      headers: { Authorization: `Bearer ${service}`, apikey: service },
    });
  } catch {
    return { ok: false, status: 502, error: 'Could not verify authorization' };
  }
  const admins = adminRes.ok ? await adminRes.json() : [];
  if (!Array.isArray(admins) || !admins.length) return { ok: false, status: 403, error: 'Not authorized' };

  return { ok: true, userId: user.id, user };
}
