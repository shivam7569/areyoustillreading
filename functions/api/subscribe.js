/**
 * functions/api/subscribe.js
 * =============================================================================
 * WHAT THIS FILE IS
 * -----------------------------------------------------------------------------
 * A Cloudflare Pages Function that handles `POST /api/subscribe`. It is the
 * *first* leg of the newsletter double opt-in flow: it takes an email address a
 * visitor typed into a subscribe form, validates it, screens for bots, and — if
 * the address is new or still unconfirmed — stores a "pending" record and mails
 * a confirmation link. The *second* leg (the visitor clicking that link and
 * flipping the record to `confirmed`) lives in the sibling endpoint
 * `functions/api/confirm.js` (GET /api/confirm) and is NOT handled here.
 * (Opting back out lives in `functions/api/unsubscribe.js`.)
 *
 * File-based routing: because this file sits at `functions/api/subscribe.js`,
 * Cloudflare Pages automatically wires it to the URL path `/api/subscribe`.
 * Exporting `onRequestPost` means only HTTP POST reaches this handler; other
 * verbs get Cloudflare's default 405.
 *
 * SINGLE RESPONSIBILITY
 * -----------------------------------------------------------------------------
 * "Given a subscribe submission, safely begin (or resume) double opt-in and
 * always return an indistinguishable, non-enumerating response." All the actual
 * work (DB reads/writes, email sending, Turnstile calls, validation) is
 * delegated to `../../lib/email.js`; this file is pure orchestration + policy.
 *
 * HOW IT FITS THE ARCHITECTURE
 * -----------------------------------------------------------------------------
 * Browser subscribe form  ──POST(JSON or form-encoded)──▶  THIS FUNCTION
 *   THIS FUNCTION ──▶ Turnstile (Cloudflare bot check, via lib/email.js)
 *   THIS FUNCTION ──▶ Supabase/Postgres (subscribers table, via PostgREST)
 *   THIS FUNCTION ──▶ Resend (transactional confirmation email)
 *   Confirmation link  ──▶  functions/api/confirm.js (GET /api/confirm)
 *
 * IMPORTS / DEPENDENCIES (all from ../../lib/email.js)
 * -----------------------------------------------------------------------------
 *   isValidEmail(email)                 -> bool   syntactic email check
 *   normalizeEmail(email)               -> string canonical form (lower/trim)
 *   jsonResponse(obj, status?)          -> Response  JSON reply for fetch clients
 *   redirect(path)                      -> Response  302 for classic form posts
 *   verifyTurnstile(env, token, ip)     -> bool   Cloudflare Turnstile verify;
 *                                                  a NO-OP returning true until
 *                                                  TURNSTILE_SECRET_KEY is set
 *   getByEmail(env, email)              -> row|null existing subscriber lookup
 *   insertPending(env, email, tok, iso) -> void   create new pending row
 *   setPendingToken(env, id, tok, iso)  -> void   rotate token + stamp send time
 *   sendConfirmationEmail(env, email, token)-> void  mail the opt-in link
 *
 * `env` carries Cloudflare Pages bindings/secrets (Supabase URL + service key,
 * Resend key, TURNSTILE_SECRET_KEY, etc.) consumed inside lib/email.js.
 *
 * WHAT DEPENDS ON THIS FILE
 * -----------------------------------------------------------------------------
 * Any client-side subscribe UI (the subscribe page/component) that POSTs here.
 * It supports BOTH modern JSON fetch() callers and no-JS/progressive-enhancement
 * HTML `<form method="post">` callers, and shapes its response accordingly.
 *
 * SECURITY ASSUMPTIONS & GOTCHAS
 * -----------------------------------------------------------------------------
 * - ENUMERATION RESISTANCE: every non-error path returns the *same* generic
 *   "check your inbox" message. A caller cannot tell "new address", "resent",
 *   "already confirmed", or "suppressed by cooldown" apart — so the endpoint
 *   cannot be used to discover who is subscribed. Preserve this invariant.
 * - HONEYPot: the hidden `website` field must stay empty for humans; if filled
 *   we short-circuit with a success-looking response and never touch the DB.
 * - TURNSTILE: bot verification is delegated and currently fail-OPEN by
 *   configuration (returns true until the secret is set). Once the secret is
 *   configured it becomes a hard gate. The IP is passed for Turnstile scoring.
 * - RLS RELIANCE: DB writes here run with elevated (service-role) credentials
 *   inside lib/email.js — this endpoint is trusted server code. The public
 *   subscribers table is otherwise locked by Supabase Row-Level Security so the
 *   browser's anon Supabase client cannot read/write it directly; this function
 *   is the only sanctioned write path for pending subscriptions.
 * - MAILBOX-FLOOD PROTECTION: RESEND_COOLDOWN_MS throttles repeated
 *   confirmation emails to one unconfirmed address, so an attacker cannot use
 *   this endpoint to spam a victim's inbox by resubmitting their address.
 * - TOKEN: the confirmation token is a crypto.randomUUID() (unguessable v4),
 *   regenerated on each (throttled) send so an old leaked link stops working
 *   once a newer one is issued.
 * - Detailed errors are logged server-side only (wrangler tail); clients get a
 *   generic message to avoid leaking internals.
 * =============================================================================
 */

import {
  isValidEmail,
  normalizeEmail,
  jsonResponse,
  redirect,
  verifyTurnstile,
  getByEmail,
  insertPending,
  setPendingToken,
  sendConfirmationEmail,
} from '../../lib/email.js';

// Minimum gap between confirmation emails to the SAME still-pending address.
// This is the anti-flood throttle: without it, repeatedly POSTing a victim's
// address would fire a fresh email each time. 5 minutes.
const RESEND_COOLDOWN_MS = 5 * 60 * 1000;

/**
 * POST /api/subscribe — begin double opt-in.
 *
 * Content-negotiated: JSON body from fetch() callers, or classic
 * multipart/urlencoded form POSTs from no-JS clients. The response shape mirrors
 * the request kind (JSON reply vs 302 redirect) so both UX paths work.
 *
 * @param {{ request: Request, env: Record<string, unknown> }} ctx
 *   Cloudflare Pages Function context (`env` holds secrets/bindings).
 * @returns {Promise<Response>} Always a generic, enumeration-safe response.
 */
export async function onRequestPost({ request, env }) {
  // Detect the caller's flavor up front. `isJson` drives EVERY subsequent
  // reply: true -> JSON responses for fetch()/AJAX; false -> 302 redirects to
  // dedicated pages for classic form submissions (progressive enhancement).
  const ct = request.headers.get('content-type') || '';
  const isJson = ct.includes('application/json');

  // Three inputs we care about, extracted differently per content type.
  // NOTE the field-name divergence between the two transports:
  //   - JSON callers send { email, website, turnstileToken }
  //   - form callers send email, website, and Turnstile's own widget field
  //     name `cf-turnstile-response` (what the Turnstile <script> injects).
  let email;
  let honeypot;      // the hidden anti-bot field (see below) — must be empty
  let turnstileToken;
  try {
    if (isJson) {
      const b = await request.json();
      email = b.email;
      honeypot = b.website;
      turnstileToken = b.turnstileToken;
    } else {
      const f = await request.formData();
      email = f.get('email');
      honeypot = f.get('website');
      turnstileToken = f.get('cf-turnstile-response');
    }
  } catch {
    // Body was malformed/unparseable (bad JSON, wrong encoding). Reject early
    // with a generic 400 / error redirect — never surface parser internals.
    return isJson ? jsonResponse({ ok: false, error: 'Bad request.' }, 400) : redirect('/subscribe-error');
  }

  // HONEYPOT: `website` is a decoy input hidden from humans via CSS. Real users
  // leave it blank; naive bots auto-fill every field. If it's filled we treat
  // the submitter as a bot — but return a SUCCESS-looking response (not an
  // error) so the bot can't learn the field is a trap, and we deliberately skip
  // all DB/email work. Fail-safe: costs the attacker nothing to detect, us
  // nothing to serve.
  if (honeypot) {
    return isJson ? jsonResponse({ ok: true, message: 'Check your inbox to confirm.' }) : redirect('/check-inbox');
  }

  // Syntactic validation before we spend any DB/Turnstile/email effort.
  if (!isValidEmail(email)) {
    return isJson ? jsonResponse({ ok: false, error: 'Please enter a valid email.' }, 400) : redirect('/subscribe-error');
  }
  // Canonicalize (lowercase/trim) so the same mailbox always maps to one row —
  // prevents duplicate pending records and makes the getByEmail lookup reliable.
  const normalized = normalizeEmail(email);

  // BOT VERIFICATION. `cf-connecting-ip` is the trusted client IP Cloudflare
  // injects at the edge; it's passed to Turnstile for risk scoring. This call
  // currently FAILS OPEN (returns true) until TURNSTILE_SECRET_KEY is set in
  // env — so the feature can ship dark and be armed later by adding the secret.
  const ip = request.headers.get('cf-connecting-ip') || undefined;
  if (!(await verifyTurnstile(env, turnstileToken, ip))) {
    return isJson
      ? jsonResponse({ ok: false, error: 'Verification failed. Please refresh and try again.' }, 400)
      : redirect('/subscribe-error');
  }

  try {
    // Compute time once so the cooldown comparison and the DB timestamp agree.
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const existing = await getByEmail(env, normalized);

    if (!existing) {
      // Brand-new address: create a pending row with a fresh unguessable token
      // and mail the confirmation link. (RLS blocks the browser from doing this
      // directly; this trusted function is the only sanctioned write path.)
      const token = crypto.randomUUID();
      await insertPending(env, normalized, token, nowIso);
      await sendConfirmationEmail(env, normalized, token);
    } else if (existing.status !== 'confirmed') {
      // Known but still PENDING address: they never clicked the last link, so a
      // resend is legitimate — BUT only outside the cooldown window. This is
      // the anti-flood guard: repeated submissions of a victim's address won't
      // fire more than one email per RESEND_COOLDOWN_MS.
      const last = existing.last_email_at ? Date.parse(existing.last_email_at) : 0;
      if (nowMs - last >= RESEND_COOLDOWN_MS) {
        // Rotate the token on every resend so the newest link is the only valid
        // one (an older leaked/forwarded link is invalidated), and stamp the
        // send time to restart the cooldown clock.
        const token = crypto.randomUUID();
        await setPendingToken(env, existing.id, token, nowIso);
        await sendConfirmationEmail(env, normalized, token);
      }
      // else: inside cooldown -> intentionally do nothing (silent throttle).
    }
    // FALL-THROUGH for ALL of: new, resent, throttled, and already-confirmed.
    // Every one of these returns the exact SAME generic response. This is the
    // enumeration-resistance invariant: an outside observer cannot distinguish
    // these states and therefore cannot probe who is/isn't subscribed. Do not
    // branch this response on subscriber state.
    return isJson
      ? jsonResponse({ ok: true, message: 'Check your inbox to confirm your subscription.' })
      : redirect('/check-inbox');
  } catch (err) {
    // Any failure in the DB/email pipeline lands here. Log the real reason
    // server-side only (visible via `wrangler pages deployment tail`); the
    // client gets a generic 500/error page so we never leak internals or hint
    // at whether the address existed.
    console.error('subscribe failed:', (err && err.message) || err);
    return isJson ? jsonResponse({ ok: false, error: 'Something went wrong. Try again later.' }, 500) : redirect('/subscribe-error');
  }
}
