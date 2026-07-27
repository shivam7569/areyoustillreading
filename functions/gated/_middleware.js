/**
 * functions/gated/_middleware.js
 * ============================================================================
 * SERVER-SIDE PAYWALL GATE for `/gated/<slug>` full-content HTML fragments.
 * ----------------------------------------------------------------------------
 *
 * WHAT THIS IS
 *   A Cloudflare Pages Function "middleware" that intercepts EVERY request under
 *   the `/gated/` path prefix (the `_middleware.js` filename is the Pages
 *   convention: it runs for all sibling and descendant routes of this folder,
 *   here `/gated/*`, before the static asset is served). Its `onRequest` handler
 *   decides whether the caller may receive the protected content or gets a 403.
 *
 * SINGLE RESPONSIBILITY
 *   Authorize (or deny) delivery of the FULL article body for a given post.
 *   Nothing else. It renders no HTML of its own on success — it calls `next()`,
 *   which lets Cloudflare Pages serve the underlying static `/gated/<slug>`
 *   fragment that was emitted at build time. On denial it returns a bare 403.
 *
 * HOW IT FITS THE ARCHITECTURE (Phase 3 content gating)
 *   - The public post page ships only a teaser/preview. The paid full-content
 *     body lives as a SEPARATE static fragment under `/gated/<slug>`, which the
 *     browser (via the client-side PaywallGate component) fetches with the
 *     signed-in user's Supabase access token in the `Authorization` header.
 *   - Because the fragment is a static file, it would be world-readable if
 *     exposed directly. THIS middleware is the only thing standing between an
 *     anonymous fetch and that file — it is the authoritative access-control
 *     boundary. The client-side gate is UX, not security; this is security.
 *   - Runs at the Cloudflare edge (Workers runtime), so `fetch`, `Response`,
 *     and `URL` are the global Web Platform primitives, not Node APIs.
 *
 * DEPENDENCIES / IMPORTS
 *   - No module imports. Uses only edge globals (fetch/Response/URL).
 *   - Env bindings (configured on the Pages project, injected via `context.env`):
 *       SUPABASE_URL              — base URL of the Supabase project.
 *       SUPABASE_SERVICE_ROLE_KEY — the SERVICE ROLE key. This bypasses Row-Level
 *                                   Security, so it MUST stay server-side only and
 *                                   never reach the browser. It is used here for
 *                                   trusted lookups against post_paywall, admins,
 *                                   and entitlements tables.
 *   - Supabase REST endpoints consumed:
 *       GET /rest/v1/post_paywall  — is this post currently behind the paywall?
 *       GET /auth/v1/user          — validate the caller's user token, resolve id.
 *       GET /rest/v1/admins        — owner/admin bypass.
 *       GET /rest/v1/entitlements  — has this user purchased this post?
 *
 * WHAT DEPENDS ON THIS
 *   - The client PaywallGate component (browser) relies on this returning 200
 *     (content) vs 403 (Locked) to decide whether to render the article or the
 *     purchase prompt. Any `/gated/*` request transits this function first.
 *
 * SECURITY MODEL / ASSUMPTIONS / GOTCHAS
 *   - FAIL-SAFE (fail closed): every uncertainty resolves to LOCKED. If the
 *     paywall lookup errors we ASSUME the post is paid (`paid = true`); a missing
 *     or invalid token, an unverifiable user, or any thrown error all yield 403.
 *     The only way to get content is to affirmatively prove: (a) the post is free,
 *     or (b) a validated user who is an admin OR holds an entitlement row.
 *   - We DO NOT trust RLS to protect the entitlements/admins tables here because
 *     we query them with the service-role key (which bypasses RLS). Correctness
 *     therefore depends entirely on the explicit `user_id`/`post_id` filters in
 *     the query strings below being right — not on database policy.
 *   - Token validation is delegated to Supabase's own /auth/v1/user endpoint
 *     rather than local JWT verification: Supabase is the source of truth for
 *     signature, expiry, and revocation. We never parse or trust the JWT ourselves.
 *   - `slug` is derived from the URL path and interpolated into REST query
 *     strings; every use is wrapped in encodeURIComponent to prevent PostgREST
 *     filter/query injection. Do not remove those wrappers.
 *   - This gate protects the /gated fragment ONLY. It assumes the public teaser
 *     page never inlines the paid body. If a build ever leaks full content into
 *     the public page, this middleware cannot help — the boundary is bypassed.
 *   - PERFORMANCE: a paid request for a paying customer costs up to FOUR
 *     SEQUENTIAL round-trips to Supabase from the edge (paywall lookup → token
 *     validation → admin check → entitlement check), each gating the next. This
 *     is deliberate — every step short-circuits (free post, no token, admin hit)
 *     to avoid unnecessary calls — but it does add per-request latency, so the
 *     client PaywallGate fetches this fragment once and caches the rendered body
 *     rather than re-hitting `/gated/*` on every view.
 *   - METHOD SCOPE: the handler is `onRequest` (not `onRequestGet`), so it fires
 *     for ALL HTTP methods on `/gated/*`. In practice only GETs reach here, and
 *     every method is gated identically; there is no method-specific bypass.
 * ============================================================================
 */

// Uniform "denied" response. Returned for every non-authorized path so callers
// (and the client PaywallGate) see one consistent 403 signal. Intentionally
// leaks no detail about WHY access was denied (no token vs. no entitlement vs.
// error) — a single opaque status avoids handing probers a discrimination oracle.
function locked() {
  return new Response('Locked', { status: 403, headers: { 'content-type': 'text/plain' } });
}

export async function onRequest(context) {
  // `request` = incoming Request; `env` = bound secrets/vars; `next` = hand off
  // to Cloudflare Pages to serve the underlying static asset (the success path).
  const { request, env, next } = context;
  const url = new URL(request.url);

  // Derive the post identifier from the path. We strip, in order:
  //   1. the leading `/gated/` prefix,
  //   2. a trailing `index.html` (directory-style requests resolve to it),
  //   3. any trailing slash,
  // so that `/gated/my-post/`, `/gated/my-post`, and `/gated/my-post/index.html`
  // all normalize to the same `slug` ("my-post"). This slug keys every DB lookup
  // below, so all path variants must map to one canonical value.
  const slug = url.pathname
    .replace(/^\/gated\//, '')
    .replace(/index\.html$/, '')
    .replace(/\/$/, '');
  // Empty slug means someone hit `/gated/` itself with no post — nothing to gate.
  if (!slug) return new Response('Not found', { status: 404 });

  const sb = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  // Service-role auth headers for trusted, RLS-bypassing reads. PostgREST wants
  // BOTH `apikey` and a Bearer `authorization`; here both carry the service key.
  // These headers must never be echoed to the client.
  const svc = { apikey: key, authorization: `Bearer ${key}` };

  // --- Step 1: Is this post currently behind the paywall? -------------------
  // The post_paywall table is an admin-toggled switch: a post is paid only if it
  // has a row with is_paid === true. Absence of a row => not paid => free.
  // `paid` starts true so that ANY failure (network error, non-OK response)
  // leaves the post locked rather than accidentally free — fail closed.
  let paid = true; // fail safe
  try {
    // encodeURIComponent guards against slugs containing PostgREST filter
    // metacharacters (commas, dots, parens) that could otherwise alter the query.
    const r = await fetch(
      `${sb}/rest/v1/post_paywall?post_id=eq.${encodeURIComponent(slug)}&select=is_paid`,
      { headers: svc }
    );
    if (r.ok) {
      const rows = await r.json();
      // Paid only if a row exists AND is_paid is explicitly boolean true.
      paid = rows.length > 0 && rows[0].is_paid === true;
    }
    // If r is NOT ok, `paid` keeps its safe default (true) — stays locked.
  } catch (e) {
    // Network/parse failure: re-assert the fail-closed default explicitly.
    paid = true;
  }
  // Free post: no gating needed, serve the static fragment as-is.
  if (!paid) return next(); // free → serve

  // --- Step 2: Paywalled — the caller must present a valid user token. -------
  // The client sends the signed-in user's Supabase access token as a Bearer
  // token. Extract it; anything not in `Bearer <token>` form yields no token.
  const authz = request.headers.get('Authorization') || '';
  const userToken = authz.startsWith('Bearer ') ? authz.slice(7) : '';
  if (!userToken) return locked(); // anonymous request → denied.

  // --- Step 3: Validate that token and resolve the user id. -----------------
  // We do NOT decode/verify the JWT ourselves. We ask Supabase's /auth/v1/user
  // endpoint, which is authoritative for signature, expiry, and revocation.
  // A forged/expired token yields a non-OK response and thus no userId.
  let userId = '';
  try {
    const u = await fetch(`${sb}/auth/v1/user`, {
      // NOTE: authorization here is the USER's token (to identify them), while
      // apikey is the service key (required by Supabase to accept the call).
      headers: { apikey: key, authorization: `Bearer ${userToken}` },
    });
    if (u.ok) {
      const j = await u.json();
      userId = j.id || '';
    }
  } catch (e) {} // swallow → userId stays '' → locked below (fail closed).
  if (!userId) return locked(); // token invalid/expired/revoked → denied.

  // --- Step 4: Admin bypass. ------------------------------------------------
  // The site owner (any row in `admins`) can always read paid content so they
  // can preview their own paywalled posts without buying an entitlement.
  try {
    // Queried with the service key (RLS bypassed), so the `user_id` filter is
    // the ONLY thing scoping this to the caller — it must stay exact.
    const a = await fetch(
      `${sb}/rest/v1/admins?user_id=eq.${encodeURIComponent(userId)}&select=user_id`,
      { headers: svc }
    );
    if (a.ok) {
      const rows = await a.json();
      if (rows.length > 0) return next(); // caller is an admin → serve content.
    }
  } catch (e) {} // on error, fall through to the entitlement check (fail closed).

  // --- Step 5: Entitlement check (the paying-customer path). ----------------
  // A row in `entitlements` for exactly (this user, this post) proves purchase.
  // Written by the Dodo Payments webhook after a completed order. Both filters
  // are required: user_id scopes to the caller, post_id scopes to this article —
  // omitting either would over-grant access.
  let entitled = false;
  try {
    const e = await fetch(
      `${sb}/rest/v1/entitlements?user_id=eq.${encodeURIComponent(userId)}&post_id=eq.${encodeURIComponent(slug)}&select=id`,
      { headers: svc }
    );
    if (e.ok) {
      const rows = await e.json();
      entitled = rows.length > 0; // any matching row => purchased.
    }
  } catch (e) {} // error leaves entitled=false → locked (fail closed).

  // Final decision: entitled users get the content; everyone else is denied.
  return entitled ? next() : locked();
}
