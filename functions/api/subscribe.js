import {
  isValidEmail,
  normalizeEmail,
  jsonResponse,
  redirect,
  getByEmail,
  insertPending,
  setPendingToken,
  sendConfirmationEmail,
} from '../../lib/email.js';

// Only resend a confirmation to the same pending address this often.
const RESEND_COOLDOWN_MS = 5 * 60 * 1000;

// POST /api/subscribe — start double opt-in. Accepts JSON (fetch) or form POST.
export async function onRequestPost({ request, env }) {
  const ct = request.headers.get('content-type') || '';
  const isJson = ct.includes('application/json');

  let email;
  let honeypot;
  try {
    if (isJson) {
      const b = await request.json();
      email = b.email;
      honeypot = b.website;
    } else {
      const f = await request.formData();
      email = f.get('email');
      honeypot = f.get('website');
    }
  } catch {
    return isJson ? jsonResponse({ ok: false, error: 'Bad request.' }, 400) : redirect('/subscribe-error');
  }

  // Honeypot: real users never fill this hidden field. Silently accept bots.
  if (honeypot) {
    return isJson ? jsonResponse({ ok: true, message: 'Check your inbox to confirm.' }) : redirect('/check-inbox');
  }

  if (!isValidEmail(email)) {
    return isJson ? jsonResponse({ ok: false, error: 'Please enter a valid email.' }, 400) : redirect('/subscribe-error');
  }
  const normalized = normalizeEmail(email);

  try {
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const existing = await getByEmail(env, normalized);

    if (!existing) {
      const token = crypto.randomUUID();
      await insertPending(env, normalized, token, nowIso);
      await sendConfirmationEmail(env, normalized, token);
    } else if (existing.status !== 'confirmed') {
      // Resend, but only outside the cooldown — blunts mailbox-flooding of a
      // single victim address via repeated submissions.
      const last = existing.last_email_at ? Date.parse(existing.last_email_at) : 0;
      if (nowMs - last >= RESEND_COOLDOWN_MS) {
        const token = crypto.randomUUID();
        await setPendingToken(env, existing.id, token, nowIso);
        await sendConfirmationEmail(env, normalized, token);
      }
    }
    // Already-confirmed (or within cooldown): do nothing, but return the SAME
    // generic response so the endpoint can't enumerate who is subscribed.
    return isJson
      ? jsonResponse({ ok: true, message: 'Check your inbox to confirm your subscription.' })
      : redirect('/check-inbox');
  } catch (err) {
    // Detailed error stays server-side (visible via `wrangler pages deployment tail`);
    // the client only ever sees a generic message.
    console.error('subscribe failed:', (err && err.message) || err);
    return isJson ? jsonResponse({ ok: false, error: 'Something went wrong. Try again later.' }, 500) : redirect('/subscribe-error');
  }
}
