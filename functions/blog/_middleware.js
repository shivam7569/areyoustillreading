/**
 * functions/blog/_middleware.js
 * ============================================================================
 * KV OVERLAY for published blog posts — the core of seconds-to-live publishing.
 * ----------------------------------------------------------------------------
 *
 * WHAT THIS IS
 *   A Cloudflare Pages Function middleware that intercepts every request under
 *   `/blog/*`. For an individual post page (`/blog/<slug>`), it checks the
 *   POSTS_HTML KV namespace for a rendered version of that post. If one exists
 *   (written instantly at publish time by /api/publish), it serves that HTML.
 *   Otherwise it calls next(), letting Cloudflare Pages serve the statically
 *   built page exactly as before.
 *
 * WHY IT EXISTS (the architecture decision)
 *   Publishing used to require a FULL static site rebuild on Cloudflare (~1-2
 *   min). To make publishing live in seconds WITHOUT a rebuild, the editor
 *   renders the post once at publish and writes the finished HTML to KV; this
 *   middleware then serves that KV copy immediately. KV writes are effectively
 *   instant and need no deploy, so a publish/edit is visible right away.
 *
 *   We deliberately do NOT use Astro's SSR adapter (@astrojs/cloudflare) for
 *   this: that adapter emits a top-level `_worker.js`, and Cloudflare Pages
 *   IGNORES the entire `functions/` directory whenever a `_worker.js` is
 *   present — which would disable the paywall middleware, /api/publish, the
 *   subscribe endpoint, and every other Pages Function. A Pages Function KV
 *   overlay achieves the same "render-once, serve-dynamically, edge-cache,
 *   purge-one-path" result while keeping all existing Functions intact.
 *
 * ROUTING / SCOPE
 *   - Runs for `/blog/*` only (its folder location is the Pages convention).
 *   - Intercepts ONLY individual post slugs: `/blog/<slug>`, `/blog/<slug>/`,
 *     `/blog/<slug>/index.html`. It intentionally does NOT touch the listing
 *     (`/blog/`, `/blog/index.html`) or tag pages (`/blog/tags/*`) — those keep
 *     serving their static assets (they still refresh on the next full build).
 *   - Only GET/HEAD are overlaid; any other method falls through.
 *
 * SAFETY / DEGRADATION
 *   - If the POSTS_HTML binding is absent, or the KV read throws, or the key is
 *     missing, it falls through to the static page — so a misconfiguration or KV
 *     hiccup can only ever degrade to the pre-existing static behavior, never
 *     break the route.
 *   - PAYWALL: the public post page served here is teaser-only (the paid body
 *     lives at `/gated/<slug>` behind functions/gated/_middleware.js and is not
 *     part of this HTML). So serving/caching this page cannot leak paid content.
 *     The stored HTML must never contain the paid body — the publish step is
 *     responsible for that invariant.
 *
 * ENV BINDINGS (Pages project → Settings → Bindings, for BOTH Production and
 * Preview environments):
 *   POSTS_HTML — KV namespace holding rendered post HTML, keyed by slug.
 * ============================================================================
 */
export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  // Normalize `/blog/<slug>[/ | /index.html]` → `<slug>`. The listing resolves
  // to '' and tag pages contain a '/', so both are excluded from the overlay.
  const slug = url.pathname
    .replace(/^\/blog\//, '')
    .replace(/index\.html$/, '')
    .replace(/\/$/, '');
  if (!slug || slug.includes('/')) return next();

  // Overlay reads only. Writes/other verbs are handled elsewhere (or 405 by the
  // underlying asset), never here.
  if (request.method !== 'GET' && request.method !== 'HEAD') return next();

  // Missing binding or any KV error → behave exactly like today (static page).
  const kv = env.POSTS_HTML;
  if (!kv) return next();

  let html;
  try {
    html = await kv.get(slug);
  } catch {
    return next();
  }
  if (html == null) return next(); // not published via the overlay → static asset.

  return new Response(request.method === 'HEAD' ? null : html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // Always revalidate for now so an edit is visible immediately; KV reads are
      // edge-fast. Aggressive edge caching + single-path purge lands in a later
      // phase (Workers Cache with a TTL, purged on publish).
      'cache-control': 'public, max-age=0, must-revalidate',
      'x-served-by': 'kv-overlay',
    },
  });
}
