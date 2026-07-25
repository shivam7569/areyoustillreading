// POST /api/checkout { postId } — creates a Dodo Payments hosted checkout for a
// paywalled post and returns { url }. Requires a signed-in user.
//
// =============================================================================
// FILE: functions/api/checkout.js
// -----------------------------------------------------------------------------
// WHAT THIS IS
//   A Cloudflare Pages Function (server-side, runs on Cloudflare's edge — NOT in
//   the browser). Cloudflare Pages maps this file to the route `/api/checkout`,
//   and the exported `onRequestPost` handler answers HTTP POST to that path.
//
// SINGLE RESPONSIBILITY
//   Turn "a signed-in reader wants to buy this specific post" into a Dodo
//   Payments hosted-checkout URL that the browser can redirect to. It performs
//   the pre-checkout guard checks (auth → post is actually for sale → not
//   already owned) and then asks Dodo to mint a checkout session. It does NOT
//   grant access, take payment, or write entitlements — that happens later in
//   the Dodo webhook handler (a separate Function) once payment settles.
//
// HOW IT FITS THE ARCHITECTURE (Dodo = Merchant of Record per-post paywall)
//   1. A post is marked paywalled via the `post_paywall` table (is_paid=true)
//      and mapped to a Dodo product (product_id). See PaywallGate / the admin
//      live-toggle table from Phase 3.
//   2. The browser (Supabase JS client) sends the reader's access token in the
//      Authorization header and POSTs { postId } here.
//   3. This function validates and returns { url }; the client redirects the
//      reader to Dodo's hosted checkout page.
//   4. Reader pays on Dodo (Merchant of Record — Dodo, not us, is the seller of
//      record for tax/compliance). On success Dodo redirects back to
//      /blog/<postId>/?paid=1 (return_url below) AND fires a server-to-server
//      webhook. The WEBHOOK — not this file, not the return_url — is the source
//      of truth that writes the row into `entitlements`. The `?paid=1` return is
//      only a UX hint; it must never be trusted to grant access.
//   5. On subsequent reads, PaywallGate/middleware checks `entitlements` to
//      decide whether to serve the full post.
//
// DEPENDENCIES (inputs)
//   env.SUPABASE_URL              — Supabase project base URL (PostgREST + Auth).
//   env.SUPABASE_SERVICE_ROLE_KEY — service-role key. SECRET. Bypasses RLS. Used
//                                   only for server-side reads of post_paywall /
//                                   entitlements. Must never reach the browser.
//   env.DODO_API_KEY              — Dodo secret API key. SECRET.
//   env.DODO_API_BASE             — optional Dodo API base; defaults to the TEST
//                                   host, so production MUST set this to the live
//                                   host or all charges stay in test mode.
//   request.headers.Authorization — reader's Supabase access token (Bearer).
//   request body { postId }       — which post to buy.
//
// WHAT DEPENDS ON THIS
//   The client-side buy button / PaywallGate calls POST /api/checkout and
//   redirects to the returned url. Nothing else imports this module.
//
// SECURITY ASSUMPTIONS & GOTCHAS
//   - Trust boundary: the reader is authenticated by round-tripping their token
//     to Supabase Auth (/auth/v1/user) rather than decoding it locally. We never
//     trust a user_id supplied by the client; user.id comes from Supabase.
//   - RLS reliance: reads of post_paywall/entitlements use the service-role key,
//     which BYPASSES Row-Level Security. That is intentional here (server needs
//     to see product_id and any user's entitlement), but it means every query
//     MUST be explicitly scoped (post_id / user_id filters) in code — RLS is not
//     the backstop on this path. The service key must stay server-only.
//   - No CSRF token: the endpoint is safe against CSRF because it requires a
//     Bearer access token in a custom header (not a cookie), which a cross-site
//     form cannot set.
//   - Money is not moved here. This only creates a checkout intent; the amount,
//     currency and fulfilment are governed by the Dodo product + webhook. The
//     "already purchased" check is a UX/dupe guard, NOT the entitlement
//     authority — a race could still let two sessions start; the webhook must be
//     idempotent when writing entitlements.
//   - metadata.post_id / metadata.user_id are echoed back by the webhook so it
//     knows who bought what; keep those keys in sync with the webhook handler.
//   - Error messages are deliberately vague to the client; real failure detail
//     is logged server-side (console.error) only.
// =============================================================================

/**
 * Build a JSON HTTP Response with the given status.
 * Centralised so every early-return in the handler emits a consistent shape
 * ({ error } on failure, { url } on success) with the correct content-type.
 * @param {object} obj - body to serialise.
 * @param {number} [status=200] - HTTP status code.
 * @returns {Response}
 */
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/**
 * Cloudflare Pages Functions entry point for POST /api/checkout.
 * Guards (auth → sale-eligibility → not-already-owned), then creates a Dodo
 * hosted checkout and returns its URL. Every failure path returns a JSON
 * { error } with an appropriate HTTP status; success returns { url }.
 *
 * @param {{ request: Request, env: Record<string,string> }} ctx
 *        Cloudflare-injected context. `env` carries the secrets/bindings above.
 * @returns {Promise<Response>}
 */
export async function onRequestPost({ request, env }) {
  const sb = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  // `svc` = service-role auth headers for PostgREST. This bypasses RLS, so the
  // queries below MUST carry explicit filters — the DB will not scope for us.
  const svc = { apikey: key, authorization: `Bearer ${key}` };

  // --- 1. Authenticate the reader -------------------------------------------
  // Read the reader's Supabase access token from the Authorization header. We
  // require a Bearer token in a custom header (not a cookie) — this both proves
  // sign-in and makes the endpoint CSRF-safe.
  const authz = request.headers.get('Authorization') || '';
  const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
  if (!token) return json({ error: 'Please sign in first.' }, 401);
  let user = null;
  try {
    // Verify the token by asking Supabase Auth who it belongs to, rather than
    // decoding/trusting the JWT locally. This means a revoked/expired token is
    // rejected, and the returned user.id is authoritative — we NEVER take the
    // user id from the client body. Network/parse failures fall through to the
    // guard below (fail closed: no user => 401).
    const u = await fetch(`${sb}/auth/v1/user`, {
      headers: { apikey: key, authorization: `Bearer ${token}` },
    });
    if (u.ok) user = await u.json();
  } catch (e) {}
  if (!user || !user.id) return json({ error: 'Please sign in first.' }, 401);

  // --- 2. Read the requested post from the body -----------------------------
  // Tolerate a malformed/absent body (try/catch) and reject if no postId — we
  // must know exactly which product to sell.
  let postId = '';
  try {
    const b = await request.json();
    postId = b.postId;
  } catch (e) {}
  if (!postId) return json({ error: 'Missing post.' }, 400);

  // --- 3. Confirm the post is actually for sale -----------------------------
  // Server-side authority on price/eligibility: the post must currently be
  // paywalled (is_paid) AND mapped to a Dodo product. We trust the DB here, not
  // the client — a reader cannot buy a post that the admin hasn't put up for
  // sale, and cannot buy one whose product_id is still unconfigured. The
  // post_id filter is required because the service key bypasses RLS.
  let row = null;
  try {
    const r = await fetch(
      `${sb}/rest/v1/post_paywall?post_id=eq.${encodeURIComponent(postId)}&select=is_paid,product_id`,
      { headers: svc }
    );
    if (r.ok) row = (await r.json())[0];
  } catch (e) {}
  if (!row || !row.is_paid) return json({ error: 'This post is not for sale.' }, 400);
  if (!row.product_id) return json({ error: 'This post has no product configured yet.' }, 400);

  // --- 4. Dupe guard: already purchased? ------------------------------------
  // UX guard only — stops a reader who already owns the post from paying twice.
  // Scoped to BOTH user_id and post_id (again, no RLS backstop on the service
  // key). This is NOT the entitlement authority and is racy: two concurrent
  // checkouts could both pass this check, so the webhook that writes
  // `entitlements` must be idempotent. If the lookup errors, we fail OPEN and
  // let checkout proceed (better a redundant purchase prompt than a false
  // "you already own this").
  try {
    const e = await fetch(
      `${sb}/rest/v1/entitlements?user_id=eq.${encodeURIComponent(user.id)}&post_id=eq.${encodeURIComponent(postId)}&select=id`,
      { headers: svc }
    );
    if (e.ok && (await e.json()).length > 0) return json({ error: 'You already own this post.' }, 400);
  } catch (e) {}

  // --- 5. Create the Dodo checkout session ----------------------------------
  // DODO_API_BASE defaults to the TEST host — production deployments MUST set it
  // to the live host or every charge silently stays in test mode (a real gotcha).
  const base = env.DODO_API_BASE || 'https://test.dodopayments.com';
  // Build return_url from the incoming request's own origin so it works across
  // preview/prod deployments without hardcoding a domain.
  const origin = new URL(request.url).origin;
  try {
    const res = await fetch(`${base}/checkouts`, {
      method: 'POST',
      headers: {
        // Dodo secret key — server-only. Authorises us to create a session on
        // the reader's behalf.
        authorization: `Bearer ${env.DODO_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        // One unit of the product mapped to this post.
        product_cart: [{ product_id: row.product_id, quantity: 1 }],
        // Prefill the buyer's email from the authenticated Supabase user.
        customer: { email: user.email },
        // Where Dodo redirects the browser after payment. `?paid=1` is only a UX
        // hint to show a "thanks" state — it is NOT proof of payment and must
        // never gate content on its own; the webhook grants the entitlement.
        return_url: `${origin}/blog/${postId}/?paid=1`,
        // Echoed back verbatim by the Dodo webhook so it can attribute the
        // settled payment to the right post + user. Keep these keys in sync with
        // the webhook handler that writes `entitlements`.
        metadata: { post_id: postId, user_id: user.id },
      }),
    });
    // Parse defensively — a non-JSON error body must not throw.
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Log full detail server-side (status + body) for debugging, but return a
      // vague 502 to the client so we don't leak Dodo internals.
      console.error('dodo checkout failed', res.status, JSON.stringify(data));
      return json({ error: 'Could not start checkout.' }, 502);
    }
    // Dodo has varied the URL field name across API versions; accept any of the
    // known aliases so a field rename doesn't break checkout.
    const url = data.checkout_url || data.url || data.payment_link;
    if (!url) return json({ error: 'No checkout URL returned.' }, 502);
    return json({ url });
  } catch (e) {
    // Network failure or unexpected throw reaching Dodo — log and surface a
    // generic retryable error.
    console.error('checkout error', (e && e.message) || e);
    return json({ error: 'Checkout failed. Try again later.' }, 500);
  }
}
