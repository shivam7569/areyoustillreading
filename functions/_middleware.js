/**
 * functions/_middleware.js — ROOT copy overlay (instant Studio saves).
 * ============================================================================
 * WHAT THIS IS
 *   A site-wide Cloudflare Pages Function middleware. On every public HTML page
 *   it patches the freshest Studio copy into the already-built static HTML at the
 *   edge, so an edit made in Studio → Content Management shows up in SECONDS
 *   instead of waiting for the ~1-minute Cloudflare rebuild.
 *
 * HOW IT WORKS (write → read)
 *   WRITE: each admin content endpoint (functions/api/admin/{site,projects,resume})
 *     commits the JSON to GitHub (durable) AND best-effort writes the copy tree to
 *     KV under `copy:site` / `copy:projects` / `copy:resume` with a publishedAt
 *     stamp (lib/site-copy.js writeCopy).
 *   READ (here): for a public HTML GET, read the copy tree from KV (staleness-gated
 *     against this deployment's /build-meta.json — see readFreshCopy). If a fresh
 *     tree exists, stream the static response through HTMLRewriter and replace the
 *     text of every element carrying a `data-cms="<dot.path>"` anchor whose path is
 *     present in the tree. One `copy:site` write updates the GLOBAL chrome (nav /
 *     footer / brand) on EVERY page at once, because those anchors live in the
 *     shared BaseLayout and this middleware runs on every route.
 *
 * WHY A ROOT MIDDLEWARE + HTMLRewriter (not an SSR adapter, not per-URL HTML)
 *   - Adding @astrojs/cloudflare would emit a top-level _worker.js and Cloudflare
 *     Pages then IGNORES the entire functions/ directory — killing the paywall,
 *     /api/publish, subscribe, and every overlay. So we stay a Pages Function.
 *   - Copy fans across many pages and the global chrome is on ALL of them, so a
 *     single-URL whole-page HTML swap (what the blog overlay does) cannot cover it.
 *     Rewriting anchored TEXT nodes does, from one KV blob and one read-time pass.
 *
 * COMPOSITION
 *   Pages runs the root _middleware first; its next() resolves the inner
 *   functions/blog and functions/gated middlewares and the static asset, so the
 *   HTML we transform is the final one (an instantly-published post gets fresh
 *   global chrome too). We only ever touch [data-cms]/[data-cms-attr] chrome
 *   nodes, never a /gated paid body (excluded outright below).
 *
 * SAFETY / DEGRADATION (never blank, never worse than today)
 *   Any of: POSTS_HTML binding absent, KV miss, malformed entry, stale entry
 *   (rebuild already landed), non-HTML/redirect/non-200 response, or a data-cms
 *   path with no fresh value → the untouched static page is served. HTMLRewriter
 *   only replaces a node when a non-empty string exists for its anchor, so the
 *   baked-in `|| fallback` copy always remains as the floor. A KV/edge hiccup can
 *   only ever degrade to the current static behavior.
 *
 * ENV (Pages → Settings → Bindings, BOTH Production and Preview):
 *   POSTS_HTML — the existing KV namespace (shared with the blog overlay; the
 *   `copy:` key prefix avoids collision with post slugs / __index / early: / rl:).
 * ============================================================================
 */
import { flattenCopy, readFreshCopy, emphHtml, boldHtml } from '../lib/site-copy.js';

// Which requests are overlay candidates. Excludes: non-GET/HEAD; APIs (JSON); the
// admin dashboard (its own AdminLayout, no data-cms anchors); gated paid bodies
// (must never be rewritten); hashed assets; and any file with a non-HTML extension
// (skips the KV read entirely for images/js/css/etc.).
function shouldOverlay(url, method) {
  if (method !== 'GET' && method !== 'HEAD') return false;
  const p = url.pathname;
  if (/^\/(api|admin|gated)(\/|$)/.test(p)) return false;
  if (/^\/(_astro|fonts)\//.test(p)) return false;
  if (/\.[a-z0-9]+$/i.test(p) && !/\.html?$/i.test(p)) return false;
  return true;
}

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  if (!shouldOverlay(url, request.method)) return next();
  if (!env || !env.POSTS_HTML) return next();

  // Read the site-wide copy tree (global chrome + every page's site.json copy). On
  // /projects and /resume also fold in that page's own data-file text (Slice 1b).
  let site = null;
  let page = null;
  try {
    site = await readFreshCopy(env, 'copy:site', url);
    if (/^\/projects\/?$/.test(url.pathname)) page = await readFreshCopy(env, 'copy:projects', url);
    else if (/^\/resume\/?$/.test(url.pathname)) page = await readFreshCopy(env, 'copy:resume', url);
  } catch {
    return next();
  }
  if (!site && !page) return next(); // nothing fresh → untouched static page

  // Flatten to a { dot.path → value } map. copy:site paths are already global.*/home.*
  // etc.; copy:projects/copy:resume are that page's own tree (page anchors use the
  // matching root). A later key wins on collision, but the namespaces don't overlap.
  const map = {};
  if (site) Object.assign(map, flattenCopy(site));
  if (page) Object.assign(map, flattenCopy(page));

  const res = await next();
  // Only transform real 200 HTML documents; assets, redirects, 304s and error pages
  // (e.g. the static 404, which stays chrome-fresh on the next rebuild) pass through.
  const ct = res.headers.get('content-type') || '';
  if (res.status !== 200 || !ct.includes('text/html')) return res;

  const rewriter = new HTMLRewriter()
    .on('[data-cms]', {
      element(el) {
        const path = el.getAttribute('data-cms');
        if (!path || !(path in map)) return; // no fresh value → keep the baked text
        const val = map[path];
        if (typeof val !== 'string' || !val) return; // never blank an element
        // Rich fields (headline/body with *emphasis*) reproduce the build-time
        // emph() so the overlay matches the baked markup; plain fields inject as
        // escaped text (HTMLRewriter's setInnerContent default is html:false).
        const rich = el.getAttribute('data-cms-rich');
        if (rich === 'emph') el.setInnerContent(emphHtml(val), { html: true }); // *italic*
        else if (rich === 'bold') el.setInnerContent(boldHtml(val), { html: true }); // **bold** (resume bullets)
        else el.setInnerContent(val); // plain text (escaped)
      },
    })
    .on('[data-cms-attr]', {
      element(el) {
        // data-cms-attr="content=global.seo.description" → set an ATTRIBUTE from copy
        // (SEO meta, a link href, an input placeholder). "<attr>=<dot.path>".
        const spec = el.getAttribute('data-cms-attr');
        if (!spec) return;
        const eq = spec.indexOf('=');
        if (eq < 1) return;
        const attr = spec.slice(0, eq).trim();
        const path = spec.slice(eq + 1).trim();
        if (!(path in map)) return;
        const val = map[path];
        if (typeof val !== 'string' || !val) return;
        el.setAttribute(attr, val);
      },
    });

  const out = rewriter.transform(res);
  // Preserve the original headers (content-type etc.), add a debug marker + the same
  // revalidate-each-load policy the blog overlay uses (HTML isn't edge-cached today).
  const headers = new Headers(out.headers);
  headers.set('x-served-by', 'copy-overlay');
  headers.set('cache-control', 'public, max-age=0, must-revalidate');
  return new Response(request.method === 'HEAD' ? null : out.body, { status: 200, headers });
}
