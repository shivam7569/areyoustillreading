/**
 * src/lib/admin-gate.ts — the shared CLIENT-side admin gate for every /admin page.
 * ============================================================================
 * WHAT THIS IS
 *   Browser-side helpers that decide what the admin UI shows and hand page
 *   scripts a trusted "you are admin" signal plus the auth header they need to
 *   call admin endpoints. It is the client twin of lib/require-admin.js.
 *
 * WHAT THIS IS NOT
 *   It is NOT a security boundary. getSession() reads a local token and
 *   is_admin() is a client RPC; both only gate what the browser DISPLAYS. Real
 *   protection is server-side — every mutating/admin-read endpoint independently
 *   calls requireAdmin() (lib/require-admin.js). An attacker forging the client
 *   result sees the shell but every action they attempt returns 401/403.
 *
 * WHY THE CACHE
 *   The whole /admin area is multi-route (full page loads between sections), so a
 *   returning admin would otherwise pay an is_admin() RPC round-trip on every
 *   navigation — the "sign-in check feels slow" complaint. We remember a prior
 *   success in localStorage and let AdminLayout reveal the shell OPTIMISTICALLY
 *   from that cache, then revalidate in the background. This is safe precisely
 *   because the client reveal grants no authority (see above).
 * ============================================================================
 */
import { supabase } from './supabase';

export type AdminState = 'admin' | 'not-admin' | 'signed-out';
/** owner = the site owner (in public.admins); author = an invited author/editor; reader = neither. */
export type StudioRole = 'owner' | 'author' | 'reader';
export interface AdminCheck {
  /** 'admin' = cleared to load the Studio shell (owner OR an active author). */
  state: AdminState;
  /** The signed-in user's email, when there is a session (for the topbar). */
  email?: string;
  /** Fine-grained role, used to scope the Studio nav + page access. */
  role?: StudioRole;
  /** True only for the site owner (everything); an author sees only authoring sections. */
  owner?: boolean;
  /** An author has claimed their permanent @handle (owners are always considered onboarded). */
  onboarded?: boolean;
  /** The @handle, once claimed (null until an author onboards). */
  handle?: string | null;
}

const CACHE_KEY = 'aysr:admin-ok';

/** Was this browser confirmed admin on a previous visit? Used only to reveal the
 *  shell instantly while checkAdmin() revalidates. */
export function cachedAdmin(): boolean {
  try {
    return localStorage.getItem(CACHE_KEY) === '1';
  } catch {
    return false;
  }
}
function setCache(ok: boolean): void {
  try {
    if (ok) localStorage.setItem(CACHE_KEY, '1');
    else localStorage.removeItem(CACHE_KEY);
  } catch {
    /* private mode / storage disabled — the network check still governs access */
  }
}

let pending: Promise<AdminCheck> | null = null;
/**
 * Resolve the current visitor's admin state (memoized for the page's lifetime;
 * pass force=true to re-run after an auth change). Reads the local session, then
 * confirms with the is_admin() RPC. Writes the localStorage cache on a definitive
 * signed-in answer. A network/RPC failure resolves to 'not-admin' WITHOUT
 * clearing a prior cache, so a transient blip doesn't lock a real admin out of an
 * optimistic reveal — but also never fabricates access.
 */
export function checkAdmin(force = false): Promise<AdminCheck> {
  if (pending && !force) return pending;
  pending = (async () => {
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    if (!session) {
      setCache(false);
      return { state: 'signed-out' as AdminState };
    }
    const email = session.user.email ?? undefined;
    try {
      // Owner (public.admins) AND author profile in one round-trip. Either clears the Studio;
      // the owner sees everything, an author sees only authoring sections + must onboard first.
      const [adminRes, profRes] = await Promise.all([
        supabase.rpc('is_admin'),
        supabase.rpc('my_profile'),
      ]);
      if (adminRes.error) throw adminRes.error;
      const owner = adminRes.data === true;
      const prof = Array.isArray(profRes.data) ? profRes.data[0] : profRes.data;
      const isAuthor = !!prof && (prof.role === 'author' || prof.role === 'editor');
      const allowed = owner || isAuthor;
      const role: StudioRole = owner ? 'owner' : isAuthor ? 'author' : 'reader';
      setCache(allowed);
      return {
        state: (allowed ? 'admin' : 'not-admin') as AdminState,
        email, role, owner,
        // owners never onboard; authors are onboarded once they've claimed a @handle
        onboarded: owner ? true : !!(prof && prof.handle),
        handle: (prof && prof.handle) || null,
      };
    } catch {
      // Ambiguous (offline / RPC error): report not-admin but leave any cache intact.
      return { state: 'not-admin' as AdminState, email };
    }
  })();
  return pending;
}

// A promise page scripts can await to know they're cleared to do admin-only work
// (e.g. the editor booting Crepe). AdminLayout resolves it once the check confirms
// admin; it stays pending otherwise, so non-admin code paths simply never run.
let resolveAdmin!: (c: AdminCheck) => void;
export const whenAdmin: Promise<AdminCheck> = new Promise((r) => {
  resolveAdmin = r;
});
/** Called by AdminLayout after a positive check to release whenAdmin awaiters. */
export function markAdmin(c: AdminCheck): void {
  if (c.state === 'admin') resolveAdmin(c);
}

/**
 * Run `fn` as soon as the page is (optimistically) cleared to load its admin data.
 * For a RETURNING admin (cachedAdmin) this fires IMMEDIATELY — so the Studio starts
 * fetching without first paying the is_admin() RPC round-trip that whenAdmin waits
 * on (that sequential RPC-then-fetch is the "pages lag before the numbers show"
 * complaint). Otherwise it waits for the confirmed check. Guarded to run once even
 * though both paths can fire. SAFE: every /api/admin/* fetch still carries the
 * bearer token and is re-verified server-side, so an optimistic guess that turns
 * out wrong simply gets 401s (and the gate shows the denied/sign-in screen).
 */
export function onAdminReady(fn: () => void): void {
  let ran = false;
  const go = () => { if (ran) return; ran = true; try { fn(); } catch (e) { console.error(e); } };
  if (cachedAdmin()) go();
  whenAdmin.then(go);
}

/**
 * Authorization header for calling admin endpoints. Every /admin fetch to an
 * /api/admin/* Function must include this so the server can re-verify admin.
 * Returns {} when there is no session (the call will then be correctly rejected).
 */
export async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Convenience wrapper: fetch an admin endpoint with the bearer token attached. */
export async function adminFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const auth = await authHeaders();
  return fetch(input, {
    ...init,
    // Admin data must always be fresh: never let the browser HTTP cache serve a stale
    // copy right after a write (the "I deleted it but it came back" bug). After ...init
    // so the guarantee is unconditional — no caller can accidentally re-enable caching.
    cache: 'no-store',
    headers: { ...(init.headers || {}), ...auth },
  });
}

/**
 * Stale-while-revalidate GET for the Studio: renders the LAST-SEEN response for a
 * URL instantly from sessionStorage (so returning to a page shows its numbers with
 * zero lag), then fetches fresh in the background and re-renders. `render` must be
 * idempotent (it usually just sets innerHTML/textContent) — it can run twice: once
 * with cached data (fromCache=true) then once with fresh data. On a fetch/HTTP error
 * with no cache to fall back on, render is called with { __error, status, error }.
 * Cache lives in sessionStorage (per tab, cleared when the tab closes), so it never
 * shows another visitor's data and never goes truly stale across sessions.
 */
export async function swrFetch<T = any>(
  url: string,
  render: (data: T, fromCache: boolean) => void,
  init: RequestInit = {},
): Promise<void> {
  const key = 'aysr:swr:' + url;
  let hadCache = false;
  try {
    const c = sessionStorage.getItem(key);
    if (c) { render(JSON.parse(c) as T, true); hadCache = true; }
  } catch { /* no/blocked storage — just fetch */ }
  try {
    const r = await adminFetch(url, init);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { render({ __error: true, status: r.status, error: (d as any).error } as any, false); return; }
    try { sessionStorage.setItem(key, JSON.stringify(d)); } catch { /* over quota / blocked */ }
    render(d as T, false);
  } catch (e: any) {
    if (!hadCache) render({ __error: true, error: String((e && e.message) || e) } as any, false);
  }
}
