/**
 * functions/api/confirm.js
 * =============================================================================
 * DOUBLE OPT-IN CONFIRMATION ENDPOINT (Cloudflare Pages Function)
 * -----------------------------------------------------------------------------
 * WHAT THIS IS
 *   The landing target for the "Click here to confirm your subscription" link
 *   inside the transactional email sent by `sendConfirmationEmail()` (see
 *   ../../lib/email.js). It is a route handler, deployed automatically by
 *   Cloudflare Pages because of its file path: `functions/api/confirm.js`
 *   is served at the URL `/api/confirm`. The `onRequestGet` export name is the
 *   Pages Functions convention for "handle HTTP GET for this route".
 *
 * SINGLE RESPONSIBILITY
 *   Take the one-time `token` from the query string, flip the matching
 *   subscriber row from `status = 'pending'` to `status = 'confirmed'`, and
 *   bounce the browser to a human-friendly outcome page. It owns the second
 *   (and final) leg of the double opt-in handshake. It does NOT create rows,
 *   send email, or handle unsubscribes — those live in sibling functions and
 *   in ../../lib/email.js.
 *
 * WHERE IT FITS IN THE ARCHITECTURE
 *   1. Visitor submits the subscribe form  -> functions/api/subscribe.js inserts
 *      a `pending` row with a random `confirm_token` and emails the link.
 *   2. Visitor clicks the emailed link     -> THIS file (`/api/confirm?token=…`).
 *   3. On success the browser is 302'd to the static Astro page `/subscribed`;
 *      on any failure to the static page `/subscribe-error`.
 *   Only a real recipient of the email possesses the token, so completing this
 *   step is what proves the address is genuinely owned by the clicker — the
 *   whole point of double opt-in (anti-spam, list hygiene, deliverability).
 *
 * DEPENDENCIES (imports)
 *   From ../../lib/email.js:
 *     - isUuid          : strict RFC-4122 UUID-shape check, case-insensitive
 *                         (input validation). NOTE it matches any UUID version's
 *                         shape — it does NOT enforce the v4 version nibble — but
 *                         the tokens minted upstream are v4, so that is fine here.
 *     - confirmByToken  : the actual Supabase/PostgREST PATCH that confirms the
 *                         row; returns true iff a row matched the token.
 *     - redirect        : builds a bare 302 Response with a `location` header.
 *   Runtime `env` bindings consumed indirectly (via confirmByToken):
 *     SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 *
 * WHAT DEPENDS ON THIS
 *   - The confirmation email body (sendConfirmationEmail) hard-codes the
 *     `${site}/api/confirm?token=${confirmToken}` URL that resolves here.
 *   - The static pages /subscribed and /subscribe-error are its only two exits;
 *     they must exist in the Astro build for the redirects to land somewhere.
 *
 * SECURITY / RLS ASSUMPTIONS & GOTCHAS
 *   - The `subscribers` table has Row-Level Security ENABLED with NO policies,
 *     so the anon/browser key can neither read nor write it. This endpoint only
 *     works because confirmByToken uses the SERVICE_ROLE key (which bypasses
 *     RLS) server-side. The service key never reaches the browser — it lives in
 *     the Pages Function's `env`. That is the entire security model here.
 *   - The `token` is the sole authorization credential. It is validated for
 *     shape BEFORE any DB call (isUuid) so malformed/injection-y input is
 *     rejected cheaply and never reaches PostgREST. A random UUID is
 *     effectively unguessable, which is why possession alone is sufficient.
 *   - Idempotency: confirmByToken deliberately does NOT clear confirm_token, so
 *     a second click — or an email-security scanner that prefetches the link
 *     before the human clicks — still matches and yields success rather than a
 *     confusing error. See the comment in confirmByToken for the rationale.
 *   - Fail-safe / privacy: EVERY failure path (bad token shape, no matching
 *     row, thrown DB error) funnels to the SAME generic /subscribe-error page.
 *     We intentionally do not distinguish "token malformed" from "token not
 *     found" from "database down" in the response — that avoids leaking whether
 *     a given token exists (an enumeration oracle) and keeps the UX simple.
 *   - GET is used (not POST) because it is the destination of a plain email
 *     hyperlink; there is no CSRF concern since the action is gated purely by
 *     the secret token, not by ambient session/cookie auth.
 *
 * @param {{ request: Request, env: Record<string, string> }} context
 *        Cloudflare Pages Functions invocation context.
 * @returns {Promise<Response>} Always a 302 redirect (never an error body).
 */
import { isUuid, confirmByToken, redirect } from '../../lib/email.js';

// GET /api/confirm?token=... — completes double opt-in.
export async function onRequestGet({ request, env }) {
  // Pull the one-time token straight off the query string. `new URL(...)` is
  // the Workers-native way to parse it; no framework router is involved.
  const token = new URL(request.url).searchParams.get('token');

  // Validate SHAPE before touching the database. A non-UUID token can never
  // match a real row, so we bail early — cheaper, and it keeps obviously bogus
  // or malicious input from ever reaching PostgREST. Note this also covers the
  // `token === null` (param absent) case since isUuid rejects non-strings.
  if (!isUuid(token)) return redirect('/subscribe-error');

  try {
    // Attempt the confirm. `ok` is true only if a subscriber row actually
    // matched this token; a well-formed-but-unknown token returns false (no
    // row updated) rather than throwing.
    const ok = await confirmByToken(env, token);

    // Success page on a real match; generic error page when nothing matched.
    // Both are static Astro routes — this Function's only job is the redirect.
    return redirect(ok ? '/subscribed' : '/subscribe-error');
  } catch {
    // Any thrown error (network blip, Supabase 5xx, misconfigured env) is
    // swallowed on purpose and mapped to the SAME error page. Fail-safe: we
    // never surface a stack trace or DB status to the visitor, and we never
    // leak whether the token existed. The subscriber can simply re-click.
    return redirect('/subscribe-error');
  }
}
