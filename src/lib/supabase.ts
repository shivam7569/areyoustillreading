/**
 * src/lib/supabase.ts
 * ============================================================================
 * SINGLE RESPONSIBILITY
 * ---------------------
 * Construct and export the ONE shared browser-side Supabase client instance
 * used across the front-end (Astro islands / client scripts). This is the
 * *public* client that runs in the visitor's browser. Its only job is to give
 * front-end code an authenticated (or anonymous) handle to Supabase for:
 *   - Auth (email magic-link + GitHub OAuth sign-in/out, session refresh)
 *   - Reads/writes to Postgres via PostgREST, subject to Row-Level Security
 *
 * WHERE THIS FITS IN THE ARCHITECTURE
 * -----------------------------------
 * The site is a static Astro build on Cloudflare Pages. Dynamic/privileged
 * work (paywall entitlement checks, Dodo Payments webhooks, admin actions,
 * anything needing the SERVICE-ROLE key) happens in Cloudflare Pages Functions
 * on the server — NOT here. Those server functions create their own Supabase
 * client with elevated credentials and must never import this module. This
 * module is exclusively the low-privilege, ships-to-the-browser client.
 *
 * DEPENDS ON
 * ----------
 *   - @supabase/supabase-js  ......... createClient factory
 *   - import.meta.env.PUBLIC_SUPABASE_URL       (build-time env / Vite)
 *   - import.meta.env.PUBLIC_SUPABASE_ANON_KEY  (build-time env / Vite)
 *   Both are `PUBLIC_`-prefixed so Astro/Vite intentionally INLINES them into
 *   the client bundle. They are public by design — see security note below.
 *
 * DEPENDED ON BY
 * --------------
 *   Any front-end code performing auth or data access, e.g. sign-in UI, the
 *   PaywallGate island, and other Astro components/client scripts that call
 *   `supabase.auth.*` or `supabase.from(...)`.
 *
 * SECURITY MODEL / RLS RELIANCE (read before trusting this client)
 * ----------------------------------------------------------------
 *   - The ANON key is NOT a secret. It is safe to embed in the client bundle.
 *     It only identifies the project and grants the `anon`/`authenticated`
 *     Postgres roles — it does NOT bypass authorization.
 *   - ALL access control is enforced server-side by Postgres Row-Level
 *     Security policies (and the `is_admin()` SQL function + `admins` table for
 *     privileged rows). This client can attempt any query; RLS decides what it
 *     actually gets. Never assume a table is safe just because this client can
 *     reference it — the protection lives in the RLS policy, not here.
 *   - GOTCHA: Never move a SERVICE-ROLE key into a `PUBLIC_` env var or this
 *     file. Doing so would inline a god-mode key into the browser bundle and
 *     defeat RLS entirely. Service-role usage belongs only in Pages Functions.
 *   - Because `PUBLIC_*` vars are inlined at build time (not read at runtime),
 *     changing them requires a rebuild/redeploy to take effect.
 * ============================================================================
 */
import { createClient } from '@supabase/supabase-js';

// Browser Supabase client. Uses the PUBLIC anon key + URL (safe to ship to the
// client); row-level security policies enforce per-user access on the server.
// Exported as a module-level singleton so the whole front-end shares one client
// instance (one auth/session state, one connection) rather than each caller
// spinning up its own.
export const supabase = createClient(
  import.meta.env.PUBLIC_SUPABASE_URL,
  import.meta.env.PUBLIC_SUPABASE_ANON_KEY
);
