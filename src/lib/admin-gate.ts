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
export interface AdminCheck {
  state: AdminState;
  /** The signed-in user's email, when there is a session (for the topbar). */
  email?: string;
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
      const { data: ok, error } = await supabase.rpc('is_admin');
      if (error) throw error;
      const isAdmin = ok === true;
      setCache(isAdmin);
      return { state: (isAdmin ? 'admin' : 'not-admin') as AdminState, email };
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
    headers: { ...(init.headers || {}), ...auth },
  });
}
