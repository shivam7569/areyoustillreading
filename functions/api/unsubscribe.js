/**
 * functions/api/unsubscribe.js
 * =============================================================================
 * ONE-CLICK NEWSLETTER UNSUBSCRIBE endpoint (Cloudflare Pages Function).
 *
 * WHAT THIS IS
 *   A Cloudflare Pages Function bound to the route `GET /api/unsubscribe`.
 *   Cloudflare maps the file path `functions/api/unsubscribe.js` to that URL,
 *   and invokes the exported `onRequestGet` handler for GET requests. It exists
 *   to honor the unsubscribe link that ships in every newsletter email (and the
 *   RFC 8058 List-Unsubscribe / one-click header, where a mail client may
 *   auto-fetch this URL on the user's behalf).
 *
 * SINGLE RESPONSIBILITY
 *   Take the opaque `token` from the query string, flip the matching
 *   subscriber's status to 'unsubscribed', and always send the visitor to the
 *   friendly `/unsubscribed` confirmation page. Nothing else. All the moving
 *   parts (UUID validation, the Supabase write, the redirect Response) live in
 *   ../../lib/email.js so this handler stays a thin, auditable orchestrator.
 *
 * HOW IT FITS THE ARCHITECTURE
 *   - Emails are sent via Resend. Each subscriber row carries a per-recipient
 *     `unsubscribe_token` (a random UUID) that is embedded in the outgoing
 *     link. This endpoint is the redemption side of that token.
 *   - Data lives in Supabase Postgres, reached over PostgREST. The
 *     `subscribers` table has Row-Level Security ENABLED WITH NO POLICIES, so
 *     it is completely inaccessible to the anon/public key used by the browser.
 *     The only path to mutate a row is a server-side call using the
 *     service-role key, which lives in `env` and never reaches the client.
 *     `unsubscribeByToken()` performs exactly that call.
 *   - Sibling functions in this directory (confirm.js, subscribe.js) share the
 *     same lib/email.js helpers and the same subscribers table.
 *
 * IMPORTS / DEPENDENCIES
 *   From ../../lib/email.js:
 *     - isUuid              — strict UUID-shape check (see SECURITY below).
 *     - unsubscribeByToken  — PATCHes subscribers where unsubscribe_token = ?,
 *                             setting status='unsubscribed', via the
 *                             service-role key (RLS-bypassing).
 *     - redirect            — builds a 302 Response to a given path.
 *   Runtime `env` (Cloudflare Pages bindings) is consumed transitively by
 *   unsubscribeByToken: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 *
 * WHAT DEPENDS ON THIS
 *   - Every marketing/confirmation email's unsubscribe link.
 *   - Mail clients honoring the List-Unsubscribe one-click header.
 *   - The static `/unsubscribed` page is the human-facing landing target; this
 *     function is that page's only referrer of note.
 *
 * SECURITY ASSUMPTIONS & GOTCHAS
 *   - NON-ENUMERATION: the response is IDENTICAL whether the token was valid,
 *     invalid, malformed, or already unsubscribed — always a 302 to
 *     /unsubscribed. An attacker probing tokens learns nothing about which
 *     tokens exist, so this endpoint cannot be used to enumerate subscribers.
 *   - The isUuid() gate is a cheap pre-filter: it avoids issuing a Supabase
 *     write for obviously-junk input (bots hitting the path, truncated links).
 *     It is NOT the security boundary — the token's 122 bits of UUID entropy
 *     plus RLS are. Even a well-formed but non-existent token simply matches
 *     zero rows and mutates nothing.
 *   - IDEMPOTENT & SAFE-TO-PREFETCH: unsubscribing is a terminal, repeatable
 *     state change. Corporate mail scanners / link-preview bots that GET the
 *     URL before the human clicks cause no harm — re-running just re-sets the
 *     same 'unsubscribed' status. This is why a GET (normally reserved for safe
 *     reads) is acceptable here: the one-click unsubscribe spec requires it and
 *     the operation is idempotent.
 *   - FAIL-OPEN TO THE FRIENDLY PAGE: any error from the Supabase write is
 *     swallowed so the visitor never sees a stack trace or 500. The tradeoff is
 *     that a transient DB failure shows "unsubscribed" without having persisted
 *     it; that is preferred over a scary error, and the user can retry via the
 *     same durable link. Do not "fix" this by surfacing the error.
 */

import { isUuid, unsubscribeByToken, redirect } from '../../lib/email.js';

/**
 * Handle `GET /api/unsubscribe?token=<uuid>`.
 *
 * @param {object} ctx                     Cloudflare Pages Function context.
 * @param {Request} ctx.request            The inbound HTTP request.
 * @param {Record<string,string>} ctx.env  Bound secrets/vars (Supabase creds).
 * @returns {Response}                     Always a 302 redirect to /unsubscribed.
 */
export async function onRequestGet({ request, env }) {
  // Pull the opaque unsubscribe token out of the query string. `.get()` yields
  // null when the param is absent, which isUuid() safely rejects below.
  const token = new URL(request.url).searchParams.get('token');

  // Shape-gate before touching the database: only spend a Supabase round-trip on
  // input that could plausibly be a real token. Malformed/missing tokens fall
  // straight through to the identical friendly redirect (non-enumeration).
  if (isUuid(token)) {
    try {
      // The actual state change. Runs server-side with the service-role key,
      // the only credential that can bypass the subscribers table's RLS. A
      // valid-but-unknown token simply matches no rows and is a no-op.
      await unsubscribeByToken(env, token);
    } catch {
      // Deliberately swallow ALL errors: never leak DB/internal failure to the
      // visitor. We fail open to the same success page (see FAIL-OPEN note in
      // the file header). No rethrow, no logging branch — keep it silent.
    }
  }

  // Single, uniform exit for every code path: valid token, invalid token, DB
  // error — the visitor always lands on the same confirmation page. This
  // uniformity is what makes the endpoint non-enumerating.
  return redirect('/unsubscribed');
}
