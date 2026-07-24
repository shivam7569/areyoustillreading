// Shared helpers for the email-capture Cloudflare Pages Functions.
// No external dependencies — uses the Workers-native fetch/crypto.

export function isValidEmail(email) {
  if (typeof email !== 'string') return false;
  const e = email.trim();
  return e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

export function normalizeEmail(email) {
  return String(email).trim().toLowerCase();
}

export function isUuid(s) {
  return (
    typeof s === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
  );
}

export function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export function redirect(location) {
  return new Response(null, { status: 302, headers: { location } });
}

// --- Cloudflare Turnstile ----------------------------------------------------
// Opt-in: when TURNSTILE_SECRET_KEY is unset, verification is skipped so the
// form keeps working until keys are configured. Once set, a valid token is required.
export async function verifyTurnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET_KEY) return true;
  if (!token) return false;
  const form = new URLSearchParams();
  form.set('secret', env.TURNSTILE_SECRET_KEY);
  form.set('response', token);
  if (ip) form.set('remoteip', ip);
  const res = await fetch(
    'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    { method: 'POST', body: form }
  );
  if (!res.ok) return false;
  const data = await res.json();
  return data.success === true;
}

// --- Supabase (PostgREST) ----------------------------------------------------
// The service-role key bypasses RLS; the table has RLS enabled with no policies,
// so ONLY this server-side function can read/write it.

function sbHeaders(env) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'content-type': 'application/json',
  };
}

export async function getByEmail(env, email) {
  const url = `${env.SUPABASE_URL}/rest/v1/subscribers?email=eq.${encodeURIComponent(
    email
  )}&select=id,status,last_email_at`;
  const res = await fetch(url, { headers: sbHeaders(env) });
  if (!res.ok) throw new Error(`supabase select ${res.status}: ${await res.text()}`);
  const rows = await res.json();
  return rows[0] ?? null;
}

export async function insertPending(env, email, confirmToken, nowIso) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/subscribers`, {
    method: 'POST',
    headers: { ...sbHeaders(env), prefer: 'return=minimal' },
    body: JSON.stringify([
      { email, status: 'pending', confirm_token: confirmToken, last_email_at: nowIso },
    ]),
  });
  // 409 = unique-email race (a concurrent request inserted first). Treat as fine.
  if (res.status === 409) return;
  if (!res.ok) throw new Error(`supabase insert ${res.status}: ${await res.text()}`);
}

export async function setPendingToken(env, id, confirmToken, nowIso) {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/subscribers?id=eq.${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: { ...sbHeaders(env), prefer: 'return=minimal' },
      body: JSON.stringify({
        status: 'pending',
        confirm_token: confirmToken,
        last_email_at: nowIso,
      }),
    }
  );
  if (!res.ok) throw new Error(`supabase patch ${res.status}: ${await res.text()}`);
}

export async function confirmByToken(env, token) {
  // Idempotent by design: we do NOT clear confirm_token, so a re-click — or a
  // mail-security scanner prefetching the link followed by the human's real
  // click — both still match and land on success instead of a false error.
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/subscribers?confirm_token=eq.${encodeURIComponent(token)}`,
    {
      method: 'PATCH',
      headers: { ...sbHeaders(env), prefer: 'return=representation' },
      body: JSON.stringify({ status: 'confirmed', confirmed_at: new Date().toISOString() }),
    }
  );
  if (!res.ok) throw new Error(`supabase confirm ${res.status}`);
  const rows = await res.json();
  return rows.length > 0;
}

export async function unsubscribeByToken(env, token) {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/subscribers?unsubscribe_token=eq.${encodeURIComponent(token)}`,
    {
      method: 'PATCH',
      headers: { ...sbHeaders(env), prefer: 'return=representation' },
      body: JSON.stringify({ status: 'unsubscribed' }),
    }
  );
  if (!res.ok) throw new Error(`supabase unsub ${res.status}`);
  const rows = await res.json();
  return rows.length > 0;
}

// --- Resend ------------------------------------------------------------------

export async function sendConfirmationEmail(env, email, confirmToken) {
  const site = env.SITE_URL || 'https://areyoustillreading.dev';
  const from = env.EMAIL_FROM || 'areyoustillreading <hello@areyoustillreading.dev>';
  const confirmUrl = `${site}/api/confirm?token=${confirmToken}`;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: 'Confirm your subscription',
      html: `<p>Thanks for subscribing to <strong>areyoustillreading</strong>.</p>
<p><a href="${confirmUrl}">Click here to confirm your subscription</a>.</p>
<p>If you didn't request this, you can safely ignore this email.</p>`,
    }),
  });
  if (!res.ok) throw new Error(`resend ${res.status}: ${await res.text()}`);
}
