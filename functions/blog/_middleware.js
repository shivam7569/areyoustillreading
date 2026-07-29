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
  // `/^\/blog\/?/` matches BOTH `/blog` and `/blog/` so the listing normalizes to '';
  // `/blog/<slug>` → '<slug>'; `/blog/tags/…` → 'tags/…' (has a '/').
  const slug = url.pathname
    .replace(/^\/blog\/?/, '')
    .replace(/index\.html$/, '')
    .replace(/\/$/, '');

  // Overlay reads only. Writes/other verbs are handled elsewhere.
  if (request.method !== 'GET' && request.method !== 'HEAD') return next();

  // Missing binding or any KV error → behave exactly like today (static page).
  const kv = env.POSTS_HTML;
  if (!kv) return next();

  // The blog LISTING (empty slug): inject any instantly-published posts this
  // deployment's build doesn't include yet, so they show in the list immediately.
  if (!slug) return listingOverlay(url, kv, next);
  // Tag pages and other nested paths keep their static assets.
  if (slug.includes('/')) return next();

  let raw;
  try {
    raw = await kv.get(slug);
  } catch {
    return next();
  }
  if (raw == null) return next(); // not published via the overlay → static asset.

  // KV stores JSON: { html, publishedAt }. Anything unexpected → fall through.
  let entry;
  try { entry = JSON.parse(raw); } catch { return next(); }
  if (!entry || typeof entry.html !== 'string') return next();
  // Drafts are never served on the public /blog route — an early-access draft is
  // reachable only through a tokenized /early link (functions/early.js). Fall through
  // to the static asset (which 404s for a draft, since the build excludes drafts).
  if (entry.draft) return next();

  // STALENESS GATE: serve the KV copy ONLY while it is newer than this deployment's
  // build. Once the git-commit rebuild lands (post baked in, current hashed asset
  // URLs), builtAt >= publishedAt and we hand back the fresh static page instead —
  // so a stored page's asset URLs can never go stale. Publishing writes KV with a
  // publishedAt newer than the live build, so the new post shows instantly; the
  // rebuild ~1-2 min later flips this route back to static.
  const builtAt = await getBuiltAt(url);
  if (builtAt && entry.publishedAt && entry.publishedAt <= builtAt) return next();

  return new Response(request.method === 'HEAD' ? null : entry.html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // Revalidate each load for now (KV reads are edge-fast); a Workers Cache TTL
      // with single-path purge on publish is a later optimization.
      'cache-control': 'public, max-age=0, must-revalidate',
      'x-served-by': 'kv-overlay',
    },
  });
}

// This deployment's build timestamp, from the static /build-meta.json emitted per
// build. Edge-cached, so it's one cheap subrequest amortized across requests. On any
// failure returns 0 → the staleness gate then serves the KV copy (fail toward showing
// freshly-published content rather than hiding it).
async function getBuiltAt(url) {
  try {
    const r = await fetch(new URL('/build-meta.json', url), {
      cf: { cacheTtl: 300, cacheEverything: true },
    });
    if (!r.ok) return 0;
    const j = await r.json();
    return typeof j.builtAt === 'number' ? j.builtAt : 0;
  } catch {
    return 0;
  }
}

// --- Blog listing overlay ---------------------------------------------------
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const escHtml = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// One `.post` article matching src/pages/blog/index.astro's editorial markup (same
// classes + date format), so an injected entry is indistinguishable from a built one
// and is picked up by the archive's in-page filter script. `__index` has no tags, so
// data-tags is empty (the entry shows under "All"); reading time is omitted (no body).
function listingItem(p) {
  const d = new Date(`${p.pubDate}T00:00:00.000Z`);
  const ok = !isNaN(d.valueOf());
  const human = ok ? `${SHORT_MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}` : '';
  const tags = Array.isArray(p.tags) ? p.tags : [];
  const chips = tags.length
    ? `<div class="tags">${tags.slice(0, 3).map((t) => `<span class="tag">${escHtml(t)}</span>`).join('')}</div>`
    : '';
  return `<article class="post" data-tags="${escHtml(tags.join(' '))}">` +
    `<div class="idx">&bull;</div>` +
    `<div><h3><a href="/blog/${p.slug}">${escHtml(p.title)}</a></h3>` +
    `<p>${escHtml(p.description)}</p>${chips}</div>` +
    `<div class="aside"><span class="date">${human}</span></div></article>`;
}

// Serve the static /blog listing with instantly-published posts prepended: entries
// from the __index KV key that are newer than this build AND not already in the list.
// Any miss/error degrades to the plain static listing.
async function listingOverlay(url, kv, next) {
  const res = await next();
  try {
    if (!res.ok || !(res.headers.get('content-type') || '').includes('text/html')) return res;
    const idxRaw = await kv.get('__index');
    if (!idxRaw) return res;
    const idx = JSON.parse(idxRaw);
    if (!Array.isArray(idx) || !idx.length) return res;
    const builtAt = await getBuiltAt(url);
    const html = await res.text();
    const fresh = idx.filter(
      (p) => p && p.slug && p.publishedAt &&
        (!builtAt || p.publishedAt > builtAt) &&   // published after this build
        !html.includes(`/blog/${p.slug}"`)          // and not already in the static list
    ).sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0)); // newest first
    if (!fresh.length) return new Response(html, res);
    // Inject a "Just published" group at the archive's stable anchor. The client
    // filter script picks up these .post rows automatically (they're in the DOM at
    // load). If the anchor is absent (older build), replace is a no-op → static list.
    const block = `<div class="yr" data-year="new"><h2>Just published</h2>` +
      `<span class="n">${fresh.length} new</span><span class="rule"></span></div>` +
      `<div class="post-list" data-year="new">${fresh.map(listingItem).join('')}</div>`;
    const merged = html.replace('<div id="ays-instant"></div>', `<div id="ays-instant"></div>${block}`);
    const headers = new Headers(res.headers);
    headers.set('x-served-by', 'kv-listing-overlay');
    headers.set('cache-control', 'public, max-age=0, must-revalidate');
    return new Response(merged, { status: 200, headers });
  } catch {
    return res;
  }
}
