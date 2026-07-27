// ============================================================================
// functions/api/dodo-webhook.js
// ----------------------------------------------------------------------------
// WHAT THIS FILE IS
//   A Cloudflare Pages Function that handles POST /api/dodo-webhook. It is the
//   single server-side endpoint Dodo Payments (our Merchant-of-Record payment
//   provider) calls to notify us that money has changed hands. Its ONE job:
//   take a verified `payment.succeeded` event and grant the buyer access to the
//   post they paid for by writing a row into the Supabase `entitlements` table.
//
// SINGLE RESPONSIBILITY
//   Verify webhook authenticity, then convert a successful payment into an
//   entitlement (user_id + post_id). It does nothing else — no email, no
//   receipts, no refunds. Read-side gating (deciding whether to show paywalled
//   content) lives elsewhere (PaywallGate / the /gated route + token/entitlement
//   middleware from Phase 3); this file only WRITES the entitlement.
//
// HOW IT FITS THE ARCHITECTURE
//   Browser → Dodo checkout (hosted by Dodo) → payment clears → Dodo POSTs an
//   event here → we verify + insert entitlement → later, when the buyer loads a
//   gated post, the read-side middleware sees the entitlement row and unlocks it.
//   This webhook is the ONLY trustworthy signal that a payment succeeded: never
//   grant entitlements from a browser "success" redirect, which a user can forge.
//
// PROTOCOL
//   Dodo follows the Standard Webhooks spec (standardwebhooks.com). Each request
//   carries three headers — `webhook-id`, `webhook-timestamp`, `webhook-signature`
//   — and the signature is an HMAC-SHA256 over `${id}.${timestamp}.${rawBody}`.
//   The signing key is the per-endpoint secret configured in the Dodo dashboard.
//
// DEPENDS ON (env / bindings — set as Pages Function secrets, never in code)
//   - env.DODO_WEBHOOK_SECRET       : Standard Webhooks signing secret (usually
//                                     prefixed `whsec_` and base64 after prefix).
//   - env.SUPABASE_URL              : Supabase project REST base URL.
//   - env.SUPABASE_SERVICE_ROLE_KEY : Service-role key. SECURITY: this bypasses
//                                     Row-Level Security. It MUST stay server-only
//                                     (this Function), never shipped to the client.
//   - Web Crypto (`crypto.subtle`) and `fetch` from the Cloudflare Workers runtime.
//   - Supabase PostgREST endpoint `/rest/v1/entitlements` with a UNIQUE
//     constraint on (user_id, post_id) — required for the upsert/dedupe below.
//
// DEPENDED ON BY
//   - Dodo Payments (external): configured to POST events to this URL.
//   - The paywall read path indirectly: it consumes the rows this file writes.
//
// SECURITY ASSUMPTIONS / GOTCHAS
//   - Trust boundary is the signature check. If verification fails we 400 and
//     write NOTHING, so an attacker cannot mint entitlements by forging events.
//   - We use the service-role key here precisely because RLS would otherwise
//     block an unauthenticated server from inserting on a user's behalf. That is
//     safe ONLY because the signature check has already proven the request came
//     from Dodo. Do not relax the signature gate.
//   - Idempotency: Dodo may deliver the same event more than once (retries). The
//     insert is an upsert that ignores duplicate (user_id, post_id) rows, so
//     re-delivery is harmless.
//   - We return 200 for events we cannot act on (wrong type / missing metadata)
//     so Dodo stops retrying — retrying would never help those cases. We only
//     return non-2xx for authenticity/parse failures, where a retry might.
//   - No replay-window / freshness check: the `webhook-timestamp` header is folded
//     into the signed content (so it can't be tampered with) but we do NOT reject
//     old timestamps. A returning dev might expect Standard Webhooks' recommended
//     "reject if timestamp is outside +/- N minutes" guard here; it is intentionally
//     absent. Replaying a captured, still-valid event is nonetheless harmless because
//     the entitlement insert is an idempotent upsert (a repeat is a no-op).
//   - The signature comparison (`provided.includes(expected)`) is an ordinary string
//     compare, not constant-time — hence the "constant-ish" hedge on signatureValid.
//     Low risk here (the attacker must already produce a full valid HMAC), but note
//     it if you ever harden this endpoint.
// ============================================================================

// --- Base64 <-> byte-array helpers (Workers has atob/btoa but no Buffer) -----
// atob decodes base64 to a binary string; map each char code into a Uint8Array.
const b64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
// Reverse: turn raw bytes into a binary string, then base64-encode with btoa.
// Used to render the computed HMAC in the same base64 form Dodo sends.
const bytesToB64 = (bytes) => btoa(String.fromCharCode(...bytes));

/**
 * Verify a Standard Webhooks signature (HMAC-SHA256) in constant-ish steps.
 *
 * @param {string} secret    - env.DODO_WEBHOOK_SECRET (may be `whsec_`-prefixed).
 * @param {string} id        - `webhook-id` header value.
 * @param {string} ts        - `webhook-timestamp` header value.
 * @param {string} payload   - the EXACT raw request body (must not be re-serialized).
 * @param {string} sigHeader - `webhook-signature` header value.
 * @returns {Promise<boolean>} true only if a provided signature matches ours.
 *
 * WHY it matters: this is the sole authenticity gate. A false return here means
 * we reject the request and never touch the database.
 */
async function signatureValid(secret, id, ts, payload, sigHeader) {
  // Fail closed: if any required input is missing there is nothing to verify,
  // so treat it as invalid rather than attempting a partial check.
  if (!secret || !id || !ts || !sigHeader) return false;
  // Standard Webhooks secrets are conventionally `whsec_<base64>`. Strip the
  // prefix so we sign with the actual key material, matching Dodo's signer.
  const raw = secret.startsWith('whsec_') ? secret.slice(6) : secret;
  let keyBytes;
  try {
    // Preferred path: the secret is base64 — decode it to raw key bytes.
    keyBytes = b64ToBytes(raw);
  } catch (e) {
    // Fallback: some setups store a plain (non-base64) secret. If base64 decode
    // throws, treat the string itself as the UTF-8 key bytes rather than failing.
    keyBytes = new TextEncoder().encode(raw);
  }
  // Import the key for HMAC-SHA256 signing via Web Crypto (no Node crypto here).
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  // The signed content is precisely `id.timestamp.payload` per the spec. Any
  // deviation (e.g. using a re-stringified body) would produce a mismatch.
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${ts}.${payload}`));
  // Encode our computed signature to base64 to compare against the header form.
  const expected = bytesToB64(new Uint8Array(sig));
  // Header is a space-separated list of `version,signature` (e.g. "v1,abc123").
  // A single event may carry multiple signatures (e.g. during key rotation), so
  // normalize each entry down to just its signature part (drop the `v1,` label).
  const provided = sigHeader.split(' ').map((s) => (s.includes(',') ? s.split(',')[1] : s));
  // Accept if ANY provided signature matches ours — supports overlapping keys
  // during rotation without breaking verification.
  return provided.includes(expected);
}

/**
 * Cloudflare Pages Function entry point for POST /api/dodo-webhook.
 * Runs on every webhook delivery from Dodo Payments.
 *
 * @param {{ request: Request, env: Record<string, string> }} ctx
 *   - request: the incoming webhook HTTP request.
 *   - env: Pages Function bindings/secrets (see top-of-file DEPENDS ON).
 * @returns {Promise<Response>} status-only responses; see the response contract
 *   in the doc header (2xx = stop retrying, 4xx = retry may help).
 */
export async function onRequestPost({ request, env }) {
  // Read the body as the EXACT raw text. Critical: the signature is computed
  // over these raw bytes, so we must verify against this string and never a
  // JSON.parse -> JSON.stringify round-trip (which could re-order/whitespace it).
  const payload = await request.text();
  // Pull the three Standard Webhooks headers; default to '' so a missing header
  // is treated as an empty (and thus invalid) value inside signatureValid.
  const id = request.headers.get('webhook-id') || '';
  const ts = request.headers.get('webhook-timestamp') || '';
  const sigHeader = request.headers.get('webhook-signature') || '';

  // THE TRUST GATE. `.catch(() => false)` ensures any crypto/decoding error is
  // treated as a failed verification (fail closed) rather than throwing a 500.
  const ok = await signatureValid(env.DODO_WEBHOOK_SECRET || '', id, ts, payload, sigHeader).catch(() => false);
  // Reject unauthenticated/forged requests. 400 (not 200) so Dodo may retry if
  // the failure was transient — and, crucially, we insert NOTHING on this path.
  if (!ok) return new Response('invalid signature', { status: 400 });

  // Only now, AFTER proving authenticity, do we parse the body as JSON.
  let evt = {};
  try {
    evt = JSON.parse(payload);
  } catch (e) {
    // A verified-but-unparseable body is a malformed delivery; 400 lets Dodo retry.
    return new Response('bad json', { status: 400 });
  }
  // We only care about completed payments. Every other event type (refunds,
  // disputes, checkout.created, etc.) is acknowledged with 200 so Dodo does not
  // keep retrying an event we intentionally ignore.
  if (evt.type !== 'payment.succeeded') return new Response('ignored', { status: 200 });

  // Locate the metadata we attached when creating the Dodo checkout session.
  // Dodo may nest it under `data.metadata` or place it at the top level, so we
  // check both. This metadata is how we know WHO bought WHAT — it is round-tripped
  // by Dodo from checkout creation, so it arrives inside the signed payload.
  const meta = (evt.data && evt.data.metadata) || evt.metadata || {};
  const postId = meta.post_id;
  const userId = meta.user_id;
  // Without both identifiers we cannot form an entitlement. Log a truncated
  // snapshot for debugging, but return 200: retrying will never add the missing
  // metadata, so we acknowledge and stop the retry loop rather than 4xx-looping.
  if (!postId || !userId) {
    console.error('webhook missing metadata', JSON.stringify(evt.data || evt).slice(0, 500));
    return new Response('ok', { status: 200 });
  }

  const sb = env.SUPABASE_URL;
  // Service-role key: bypasses RLS. Safe here only because the signature check
  // above already established the caller is Dodo. Never expose this key client-side.
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    // Upsert the entitlement via PostgREST. `on_conflict=user_id,post_id` targets
    // the unique constraint so duplicate deliveries collide instead of erroring.
    const r = await fetch(`${sb}/rest/v1/entitlements?on_conflict=user_id,post_id`, {
      method: 'POST',
      headers: {
        // Both headers carry the service-role key: `apikey` is Supabase's gateway
        // check, `authorization: Bearer` is what PostgREST uses for the DB role.
        apikey: key,
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        // resolution=ignore-duplicates -> idempotent: a repeat (user_id, post_id)
        //   is silently dropped, so re-delivered webhooks don't double-insert.
        // return=minimal -> we don't need the row echoed back, saving bandwidth.
        prefer: 'resolution=ignore-duplicates,return=minimal',
      },
      // Body is an array because PostgREST bulk-insert expects a JSON array.
      body: JSON.stringify([{ user_id: userId, post_id: postId }]),
    });
    // 409 = conflict (duplicate) which, with ignore-duplicates, is an expected
    // no-op success, so we don't log it as an error. Anything else that's not ok
    // is a genuine failure worth surfacing in logs.
    if (!r.ok && r.status !== 409) {
      console.error('entitlement insert failed', r.status, await r.text());
    }
  } catch (e) {
    // Network/runtime error talking to Supabase. We log it but deliberately fall
    // through to the 200 below (see note on the final return).
    console.error('entitlement error', (e && e.message) || e);
  }

  // Always 200 once we've reached the insert stage. GOTCHA/TRADE-OFF: even if the
  // Supabase insert failed above, we return 200 so Dodo does not spam retries.
  // The payment is real; a failed insert is recovered operationally (via the
  // logged error) rather than by webhook retry. If you want automatic retry on
  // DB failure, this is the line to change to a non-2xx status.
  return new Response('ok', { status: 200 });
}
