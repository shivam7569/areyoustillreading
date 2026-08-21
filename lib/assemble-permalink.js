/**
 * src/lib/assemble-permalink.mjs — assemble a DB post page from the permalink-shell donor.
 *
 * Given the fetched /permalink-shell HTML (full reader chrome + sentinels, with the CURRENT
 * deployment's asset URLs) and a get_public_post row, returns the complete page HTML for the
 * /@* edge middleware to serve. Targeted string replacement of the shell's sentinels — no DOM
 * parsing — so it can't drift from the shell's head/markup. body_html is already sanitized +
 * rendered by the shared pipeline (db/markdown-config sanitize) AND re-vetted by the inert-guard
 * at publish, so it is injected verbatim.
 *
 * CSP NONCE: when a nonce is passed, the shell's OWN <script> tags are stamped with it FIRST
 * (nonceScripts), before body_html is substituted — so the first-party inline scripts run under
 * the strict nonce CSP the middleware sets, while any script inside the injected author body_html
 * gets no nonce and cannot execute. See lib/permalink-headers.js.
 */
import { nonceScripts } from './permalink-headers.js';

const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const fmtDateUTC = (d) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;

// The multi-author byline inner HTML: avatar (image or initial) + author links + date + tags.
function bylineHtml(row) {
  const authors = Array.isArray(row.authors) && row.authors.length
    ? row.authors
    : [{ handle: row.primary_handle, name: row.primary_name, avatar: row.primary_avatar }];
  const primary = authors[0];
  const avatar = primary.avatar
    ? `<div class="avatar"><img src="${esc(primary.avatar)}" alt="" loading="lazy"></div>`
    : `<div class="avatar" aria-hidden="true">${esc(((primary.name || 'a').trim()[0] || 'a').toUpperCase())}</div>`;
  const link = (a) => `<a href="/@${esc(a.handle)}">${esc(a.name)}</a>`;
  let names;
  if (authors.length <= 1) names = link(primary);
  else if (authors.length === 2) names = `${link(authors[0])} <span class="co">&amp; ${link(authors[1])}</span>`;
  else names = `${link(authors[0])} <span class="co">&amp; ${authors.length - 1} others</span>`;
  const d = new Date(row.pub_date);
  const dateHtml = isNaN(d.valueOf()) ? '' : `<time datetime="${d.toISOString()}">${fmtDateUTC(d)}</time>`;
  const tags = (row.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('');
  return `${avatar}<div class="who"><b>${names}</b><small>${dateHtml}</small></div>`
    + `<span class="nums" data-read-min="${esc(row.reading_min || 1)}" data-read-unit="min read">${esc(row.reading_min || 1)} min read</span>`
    + (tags ? `<div class="btags">${tags}</div>` : '');
}

// Field (owner-scoped) above the series line + part. Empty when the post isn't in a series.
function crumbHtml(row) {
  if (!row.series_title) return '';
  const field = row.field_title
    ? `<a class="fd" href="/@${esc(row.field_owner_handle)}/f/${esc(row.field_slug)}">${esc(row.field_title)}</a>` : '';
  const part = row.series_part != null
    ? `<span class="pt">Part ${esc(row.series_part)}${row.series_total ? ` of ${esc(row.series_total)}` : ''}</span>` : '';
  const series = `<a href="/@${esc(row.series_owner_handle)}/s/${esc(row.series_slug)}">${esc(row.series_title)}</a>`;
  return `<p class="pcrumb">${field}<span class="cr">${series}${part}</span></p>`;
}

/**
 * @param {string} shellHtml  fetched /permalink-shell page HTML
 * @param {object} row        one get_public_post() row
 * @param {string} canonicalPath  e.g. "/@shivam/feature-test"
 * @param {string} canonicalUrl   absolute, e.g. "https://site/@shivam/feature-test"
 * @param {string} [nonce]        CSP nonce to stamp onto the shell's first-party scripts
 * @returns {string} full page HTML
 */
export function assemblePermalinkHtml(shellHtml, row, canonicalPath, canonicalUrl, nonce) {
  // Nonce the SHELL scripts before ANY substitution, so author body_html (injected last) is
  // never stamped. No-op when nonce is absent.
  const base = nonce ? nonceScripts(shellHtml, nonce) : shellHtml;
  return base
    .split('AYSRZZTITLE').join(esc(row.title))
    .split('AYSRZZDESC').join(esc(row.description || ''))
    .split('AYSRZZURL').join(esc(canonicalUrl))
    // The reader islands (highlights/notes/comments/feedback/reader-progress) key on the
    // globally-unique post UUID (not the per-author slug, which would collide across authors).
    .split('AYSRZZUUID').join(row.post_id)
    .split('AYSRZZAUTHOR').join(esc(row.primary_name || ''))
    // og:image + twitter:image: the shell baked the branded default (/og/aysr.png); point them at
    // this post's card via the /ogp fallback (serves the per-post PNG, or the default if none built).
    .split('/og/aysr.png').join(`/ogp/${row.primary_handle}/${row.slug}`)
    // canonical + og:url the shell baked from its own /permalink-shell path. Trailing-slash
    // form ONLY — the bare form also matches a hashed /_astro/permalink-shell*.css asset name.
    .split('/permalink-shell/').join(canonicalPath + '/')
    // crumb → field/series breadcrumb (or nothing); byline → multi-author inner; body → sanitized HTML.
    // FUNCTION replacements (not strings): the replacement text is author-influenced (body_html, and
    // esc() does not escape `$`), so a string replacement would let a `$&`/`$'`/`$\`` in it splice
    // shell content. A function return is inserted verbatim — no $-pattern interpretation.
    .replace(/<div data-shell-crumb[^>]*><\/div>/, () => crumbHtml(row))
    .replace(/<div class="byline"[^>]*data-shell-byline[^>]*><\/div>/, () => `<div class="byline">${bylineHtml(row)}</div>`)
    .replace(/<div data-shell-body[^>]*><\/div>/, () => row.body_html || '');
}
