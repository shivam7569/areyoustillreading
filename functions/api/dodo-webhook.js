// POST /api/dodo-webhook — Dodo Payments webhook (Standard Webhooks spec).
// Verifies the signature, then on `payment.succeeded` writes the entitlement row.

const b64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const bytesToB64 = (bytes) => btoa(String.fromCharCode(...bytes));

async function signatureValid(secret, id, ts, payload, sigHeader) {
  if (!secret || !id || !ts || !sigHeader) return false;
  const raw = secret.startsWith('whsec_') ? secret.slice(6) : secret;
  let keyBytes;
  try {
    keyBytes = b64ToBytes(raw);
  } catch (e) {
    keyBytes = new TextEncoder().encode(raw);
  }
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${ts}.${payload}`));
  const expected = bytesToB64(new Uint8Array(sig));
  // Header is a space-separated list of `version,signature` (e.g. "v1,abc123").
  const provided = sigHeader.split(' ').map((s) => (s.includes(',') ? s.split(',')[1] : s));
  return provided.includes(expected);
}

export async function onRequestPost({ request, env }) {
  const payload = await request.text();
  const id = request.headers.get('webhook-id') || '';
  const ts = request.headers.get('webhook-timestamp') || '';
  const sigHeader = request.headers.get('webhook-signature') || '';

  const ok = await signatureValid(env.DODO_WEBHOOK_SECRET || '', id, ts, payload, sigHeader).catch(() => false);
  if (!ok) return new Response('invalid signature', { status: 400 });

  let evt = {};
  try {
    evt = JSON.parse(payload);
  } catch (e) {
    return new Response('bad json', { status: 400 });
  }
  if (evt.type !== 'payment.succeeded') return new Response('ignored', { status: 200 });

  const meta = (evt.data && evt.data.metadata) || evt.metadata || {};
  const postId = meta.post_id;
  const userId = meta.user_id;
  if (!postId || !userId) {
    console.error('webhook missing metadata', JSON.stringify(evt.data || evt).slice(0, 500));
    return new Response('ok', { status: 200 });
  }

  const sb = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const r = await fetch(`${sb}/rest/v1/entitlements?on_conflict=user_id,post_id`, {
      method: 'POST',
      headers: {
        apikey: key,
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        prefer: 'resolution=ignore-duplicates,return=minimal',
      },
      body: JSON.stringify([{ user_id: userId, post_id: postId }]),
    });
    if (!r.ok && r.status !== 409) {
      console.error('entitlement insert failed', r.status, await r.text());
    }
  } catch (e) {
    console.error('entitlement error', (e && e.message) || e);
  }

  return new Response('ok', { status: 200 });
}
