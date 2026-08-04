/**
 * lib/site-copy.js — shared helpers for the INSTANT copy overlay.
 * ============================================================================
 * The Studio commits copy (src/data/site.json, projects.json, resume.json) to
 * GitHub, which the static site bakes in on the next Cloudflare rebuild (~1 min).
 * To reflect an edit in *seconds* instead, each save also writes the fresh copy
 * tree to KV (writeCopy), and a root Pages middleware (functions/_middleware.js)
 * patches it into the already-built HTML at the edge via HTMLRewriter, keyed by
 * `data-cms="<dot.path>"` anchors that mirror the JSON's own key paths.
 *
 * This is the copy analogue of the blog KV overlay (functions/blog/_middleware.js
 * + functions/api/publish.js): same POSTS_HTML namespace, same publishedAt-vs-
 * build-meta staleness gate, same best-effort/non-fatal write discipline. The one
 * divergence: copy fans out across many pages (global nav/footer live on EVERY
 * page), so instead of swapping one URL's whole HTML we replace the TEXT of
 * anchored nodes — which is what makes a single global edit update the whole site.
 *
 * Framework-free on purpose: runs in a Cloudflare Worker (fetch/HTMLRewriter side)
 * AND imports cleanly into Node/vitest for unit tests. No Astro, no DOM.
 * ============================================================================
 */

/**
 * Flatten a nested copy object into a flat { 'dot.path': string } map of its
 * STRING leaves only. Arrays are indexed numerically ('about.body.0'). Numbers,
 * booleans and null are skipped — the overlay only ever replaces text, never
 * structure, so a non-string value has nothing to anchor. The dot-paths here are
 * exactly the paths the Studio editor and the `data-cms` anchors use.
 */
export function flattenCopy(obj, prefix = '', out = {}) {
  if (obj == null) return out;
  if (typeof obj === 'string') {
    if (prefix) out[prefix] = obj;
    return out;
  }
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => flattenCopy(v, prefix ? `${prefix}.${i}` : String(i), out));
    return out;
  }
  if (typeof obj === 'object') {
    for (const k of Object.keys(obj)) flattenCopy(obj[k], prefix ? `${prefix}.${k}` : k, out);
    return out;
  }
  return out; // numbers / booleans — not overlaid
}

const HTML_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Escape the five HTML-significant characters. Used before any html:true injection. */
export const escapeHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => HTML_ESC[c]);

/**
 * Inline emphasis: `*asterisk*` → <em>…</em>, everything else escaped. Mirrors the
 * build-time emph() helper so a rich field overlaid at the edge renders byte-for-
 * byte like the baked page. Only fields whose anchor carries data-cms-rich="emph"
 * are run through this; plain fields are injected as escaped text.
 */
export function emphHtml(s) {
  return escapeHtml(s).replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
}

/**
 * Inline strong: `**double-asterisk**` → <b>…</b>, everything else escaped. Mirrors
 * the resume page's build-time mark() helper (which emits <b> for **metric**), so a
 * bullet overlaid at the edge (data-cms-rich="bold") matches the baked markup.
 */
export function boldHtml(s) {
  return escapeHtml(s).replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
}

/**
 * Decide whether an edit to a structured data file (projects.json / resume.json) is
 * "text only" — i.e. its changes are confined to the ANCHORED text paths the copy
 * overlay can patch in place — so a Studio save can honestly say "live now". Any
 * structural change (a row/key added or removed, a layout/number/boolean flip, or an
 * edit to a NON-anchored string like a layout token or a link href) returns false, so
 * the caller falls back to the rebuild. Conservative by construction: a path missing
 * from `anchoredRe` just means that edit is treated as "not instant", never a false
 * "live now".
 *
 * Mechanism: build a "skeleton" of each object with every anchored-text string blanked
 * to '' (so edits to those are ignored) and everything else — keys, array shape,
 * numbers, booleans, non-anchored strings — kept verbatim, then compare skeletons.
 */
export function textOnlyEdit(oldObj, newObj, anchoredRe) {
  const skel = (o, path) => {
    if (typeof o === 'string') return anchoredRe.test(path) ? '' : o;
    if (Array.isArray(o)) return o.map((v, i) => skel(v, path ? `${path}.${i}` : String(i)));
    if (o && typeof o === 'object') {
      const r = {};
      for (const k of Object.keys(o).sort()) r[k] = skel(o[k], path ? `${path}.${k}` : k);
      return r;
    }
    return o;
  };
  try {
    return JSON.stringify(skel(oldObj, '')) === JSON.stringify(skel(newObj, ''));
  } catch {
    return false;
  }
}

/**
 * Best-effort KV write of a copy tree, stamped with publishedAt for the staleness
 * gate. NON-FATAL by contract: a KV miss must never fail the GitHub commit (the
 * commit is the durable source of truth), so callers only use the boolean to
 * surface an `instant` flag to the Studio. TTL just has to outlive the rebuild;
 * after it the overlay KV-misses and requests go straight to the fresh static page.
 */
export async function writeCopy(env, key, content, ttl = 3600) {
  if (!env || !env.POSTS_HTML) return false;
  try {
    await env.POSTS_HTML.put(key, JSON.stringify({ content, publishedAt: Date.now() }), { expirationTtl: ttl });
    return true;
  } catch {
    return false;
  }
}

/**
 * This deployment's build timestamp, from the per-build static /build-meta.json
 * (src/pages/build-meta.json.js). Edge-cached, so it is one cheap subrequest
 * amortized across requests. On any failure returns 0 → the gate then serves the
 * KV copy (fail toward showing the freshly-saved edit rather than hiding it),
 * exactly like the blog overlay's getBuiltAt.
 */
export async function getBuiltAt(url) {
  try {
    const r = await fetch(new URL('/build-meta.json', url), { cf: { cacheTtl: 300, cacheEverything: true } });
    if (!r.ok) return 0;
    const j = await r.json();
    return typeof j.builtAt === 'number' ? j.builtAt : 0;
  } catch {
    return 0;
  }
}

/**
 * Read a fresh copy tree from KV under `key`, applying the SAME staleness gate as
 * the blog overlay: once the git-commit rebuild bakes the edit in (builtAt >=
 * publishedAt) we return null so the static page wins and a stored copy can never
 * outlive its deployment (its anchored strings would otherwise keep overriding a
 * newer build). Any missing binding / KV miss / parse error → null → the caller
 * serves the untouched static page. Only reaches getBuiltAt when an entry exists,
 * so the steady-state cost is a single KV get that returns null.
 */
export async function readFreshCopy(env, key, url) {
  if (!env || !env.POSTS_HTML) return null;
  let raw;
  try {
    raw = await env.POSTS_HTML.get(key);
  } catch {
    return null;
  }
  if (raw == null) return null;
  let entry;
  try {
    entry = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!entry || typeof entry.content !== 'object' || entry.content == null) return null;
  const builtAt = await getBuiltAt(url);
  if (builtAt && entry.publishedAt && entry.publishedAt <= builtAt) return null;
  return entry.content;
}
