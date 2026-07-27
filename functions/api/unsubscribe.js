/**
 * functions/api/unsubscribe.js
 * =============================================================================
 * ONE-CLICK NEWSLETTER UNSUBSCRIBE endpoint (Cloudflare Pages Function).
 *
 * WHAT THIS IS
 *   A Cloudflare Pages Function bound to the route `/api/unsubscribe`, honoring
 *   the unsubscribe link that ships in every newsletter email. It exposes TWO
 *   verbs with a deliberate split:
 *     - GET  → a NON-MUTATING confirmation page (a single "Confirm" button).
 *     - POST → the actual state change, serving BOTH a human clicking Confirm
 *              AND the RFC 8058 one-click header (mail client auto-POST).
 *   The GET-is-safe / POST-mutates split is intentional: link-scanning mail
 *   gateways and preview bots pre-fetch (GET) every href in delivered mail, so a
 *   GET that unsubscribed would silently remove engaged readers at broadcast
 *   scale. RFC 8058 exists precisely to move the automated path onto POST.
 *
 * SINGLE RESPONSIBILITY
 *   Take the opaque `token` from the query string and, on POST, flip the matching
 *   subscriber's status to 'unsubscribed'. GET renders a confirm page and mutates
 *   nothing. The moving parts (UUID validation, the Supabase write) live in
 *   ../../lib/email.js so these handlers stay thin, auditable orchestrators.
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
 *   - NON-ENUMERATION: responses are IDENTICAL whether the token is valid,
 *     invalid, malformed, or already unsubscribed. GET always renders the same
 *     confirm page; the human POST always 302s to /unsubscribed; the one-click
 *     POST always 200s. An attacker probing tokens learns nothing about which
 *     exist, so this endpoint cannot be used to enumerate subscribers.
 *   - GET IS SAFE (mutates nothing): a bare GET — mail-scanner link prefetch,
 *     link preview, or a curious click — only shows a confirm page. Nobody is
 *     unsubscribed until a POST. This is why the visible email link can be a
 *     plain <a href> without risking scanner-driven silent unsubscribes.
 *   - The isUuid() gate is a cheap pre-filter on the POST write path: it avoids
 *     a Supabase write for obviously-junk input. It is NOT the security boundary
 *     — the token's 122 bits of UUID entropy plus RLS are. Even a well-formed but
 *     non-existent token simply matches zero rows and mutates nothing.
 *   - IDEMPOTENT: unsubscribing is a terminal, repeatable state change, so a
 *     duplicate one-click POST (or a re-submit) just re-sets the same status.
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
/**
 * Shared state change: shape-gate the token, then (best-effort, error-swallowing)
 * flip the matching row to 'unsubscribed'. Runs server-side with the service-role
 * key — the only credential that can bypass the subscribers table's RLS. A
 * valid-but-unknown token simply matches no rows and is a no-op. The boolean
 * result of unsubscribeByToken is intentionally DISCARDED and never branched on:
 * reacting to it would leak whether a token exists, defeating non-enumeration.
 * ONLY the POST verbs below call this — a bare GET must never mutate (see header).
 */
async function applyUnsubscribe(env, token) {
  if (!isUuid(token)) return;
  try {
    await unsubscribeByToken(env, token);
  } catch {
    // Deliberately swallow ALL errors: never leak DB/internal failure. We fail
    // open (see FAIL-OPEN note in the file header). No rethrow, no logging.
  }
}

/**
 * A small, self-contained confirmation page for GET. Rendered IDENTICALLY for any
 * token (valid, invalid, or missing) so it leaks nothing (non-enumeration). The
 * single button POSTs the token back to this same route, where the actual
 * unsubscribe happens — so a bare GET (mail-scanner link prefetch, link preview)
 * changes NO state. The action keeps the token in the query string (never a form
 * field that could be logged elsewhere).
 */
function confirmPage(token) {
  const action = '/api/unsubscribe?token=' + encodeURIComponent(token || '');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="robots" content="noindex" />
<title>Unsubscribe</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
    background:#f6f7f9; color:#1a1a1a; }
  @media (prefers-color-scheme: dark){ body{ background:#0f1115; color:#e5e7eb; } .card{ background:#171a21 !important; border-color:#2a2f3a !important; } }
  .card { max-width:420px; margin:24px; padding:32px; text-align:center; background:#fff;
    border:1px solid #e5e7eb; border-radius:12px; }
  h1 { margin:0 0 8px; font-size:20px; letter-spacing:-0.01em; }
  p { margin:0 0 24px; color:#6b7280; line-height:1.5; }
  button { border:0; border-radius:8px; background:#111827; color:#fff; font-size:15px;
    font-weight:600; padding:12px 22px; cursor:pointer; }
  a { display:inline-block; margin-top:16px; color:#9ca3af; font-size:14px; }
</style></head>
<body><div class="card">
  <h1>Unsubscribe?</h1>
  <p>You'll stop receiving new-post emails from areyoustillreading. You can resubscribe anytime.</p>
  <form method="POST" action="${action}"><button type="submit">Confirm unsubscribe</button></form>
  <a href="/">Never mind, take me back</a>
</div></body></html>`;
}

/**
 * `GET /api/unsubscribe?token=<uuid>` — NON-MUTATING confirmation page.
 * A GET must be a safe method: link-scanning mail gateways (Proofpoint, Mimecast,
 * Defender Safe Links) and link-preview bots pre-fetch every href in delivered
 * mail. If GET unsubscribed, those prefetches would silently remove engaged
 * readers at broadcast scale. So GET only shows a confirm page; the button POSTs.
 */
export async function onRequestGet({ request }) {
  const token = new URL(request.url).searchParams.get('token');
  return new Response(confirmPage(token), {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

/**
 * `POST /api/unsubscribe?token=<uuid>` — the actual state change, for BOTH:
 *   1. RFC 8058 one-click: a mail client (Gmail/Apple/Yahoo) that saw our
 *      `List-Unsubscribe` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click`
 *      headers POSTs here with a `List-Unsubscribe=One-Click` body, no human
 *      present — so we return a bare 200 (what the spec expects).
 *   2. A human clicking "Confirm unsubscribe" on the GET page above — we send
 *      them to the friendly /unsubscribed result page.
 * Both apply the same idempotent change; a duplicate/scanner POST is harmless.
 */
export async function onRequestPost({ request, env }) {
  const token = new URL(request.url).searchParams.get('token');
  await applyUnsubscribe(env, token);
  // Distinguish the machine one-click POST (expects 2xx, no navigation) from the
  // human confirm-form POST (wants the friendly page) by the RFC 8058 body marker.
  let oneClick = false;
  try {
    oneClick = /List-Unsubscribe=One-Click/i.test((await request.text()) || '');
  } catch { /* unreadable body → treat as human, fall through to redirect */ }
  return oneClick ? new Response(null, { status: 200 }) : redirect('/unsubscribed');
}
