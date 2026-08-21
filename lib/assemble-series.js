/**
 * lib/assemble-series.js — assemble a DB SERIES page from the permalink-series-shell donor.
 *
 * Given the fetched /permalink-series-shell HTML (reader chrome + sentinels, with the CURRENT
 * deployment's asset URLs) + a get_public_series row + its list_series_posts rows, returns the
 * full /@handle/s/slug page HTML for the edge middleware to serve. Targeted string replacement
 * of the shell's sentinels — no DOM parsing. The silk plate is drawn from the SAME generator the
 * built /series page uses (src/lib/series-plate.mjs), so a DB series looks byte-identical.
 */
import { combLines, spine, washFor } from '../src/lib/series-plate.mjs';

const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtMonth = (d) => (d && !isNaN(d.valueOf()) ? `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` : '');

const STATUS_LABEL = { 'in-progress': 'In progress', complete: 'Complete', paused: 'Paused' };

// h1 with the last word italicised + a full stop, matching the editorial pages.
export function headline(title) {
  const words = String(title || '').trim().split(/\s+/);
  const last = (words.pop() || title || '').replace(/[.…]+$/, '') + '.';
  const head = words.join(' ');
  return `${head ? esc(head) + ' ' : ''}<em>${esc(last)}</em>`;
}

// The silk plate SVG — byte-identical to SeriesPlate.astro's markup, drawn from the published
// parts' reading times + the (declared or derived) total. `tot` must be numeric.
export function plateSvg(mins, tot) {
  const comb = combLines(tot);
  const sp = spine(mins, tot);
  let s = '<svg viewBox="0 0 300 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true">';
  for (const ln of comb) s += `<path d="${ln.d}" fill="none" stroke="var(--accent)" stroke-width="${ln.w}" opacity="${ln.o}"/>`;
  if (sp.tail) s += `<path d="${sp.tail}" fill="none" stroke="var(--accent)" stroke-width="1.4" opacity="0.3" stroke-dasharray="5 7" stroke-linecap="round"/>`;
  if (sp.path) s += `<path d="${sp.path}" fill="none" stroke="var(--accent)" stroke-width="2.6" stroke-linecap="round"/>`;
  for (const p of sp.solidNodes) s += `<circle cx="${p[0]}" cy="${p[1]}" r="4.8" fill="var(--accent)"/>`;
  for (const p of sp.futureNodes) s += `<circle cx="${p[0]}" cy="${p[1]}" r="3.8" fill="var(--paper)" stroke="var(--accent)" stroke-width="1.6" opacity="0.85"/>`;
  return s + '</svg>';
}

// The progress line (badge · segments · counts + date range), shared by the series page and
// each series article on the field page.
export function progHtml(pub, tot, status, first, last) {
  const label = STATUS_LABEL[status] || 'In progress';
  const segs = Array.from({ length: Math.min(tot, 8) }, (_, i) => (i < pub ? '<i class="on"></i>' : '<i></i>')).join('');
  const range = first ? `${fmtMonth(first)}${last && first.valueOf() !== last.valueOf() ? ` – ${fmtMonth(last)}` : ''}` : '';
  return `<div class="prog">`
    + `<span class="badge${status !== 'in-progress' ? ' quiet' : ''}">${esc(label)}</span>`
    + `<span class="segs">${segs}</span>`
    + `<span><em>${pub}${tot > pub ? ` of ${tot}` : ''}</em> published${range ? ` · ${esc(range)}` : ''}</span>`
    + `</div>`;
}

// The ordered list of published parts. Each part links to its OWN canonical permalink.
export function partsHtml(parts) {
  const li = parts.map((p, i) => {
    const d = new Date(p.pub_date);
    const meta = `${fmtMonth(isNaN(d.valueOf()) ? null : d)}${p.reading_min ? ` · ${p.reading_min} min` : ''}`.replace(/^ · /, '');
    return `<li><a href="/@${esc(p.primary_handle)}/${esc(p.slug)}">`
      + `<span class="n">${i + 1}</span>`
      + `<span class="t">${esc(p.title)}</span>`
      + `<span class="lead"></span>`
      + `<span class="m">${esc(meta)}</span>`
      + `</a></li>`;
  }).join('');
  return `<ol class="parts">${li}</ol>`;
}

// Derive the display status when the DB leaves it null: complete once every declared part is
// published, otherwise in-progress. (Matches resolveSeries in src/lib/series-plate.mjs.)
export function seriesStatus(row, pub, tot) {
  return row.status || (row.total && pub >= row.total ? 'complete' : 'in-progress');
}

/**
 * @param {string} shellHtml       fetched /permalink-series-shell page HTML
 * @param {object} row             one get_public_series() row
 * @param {object[]} parts         list_series_posts() rows (published, ordered)
 * @param {string} canonicalPath   e.g. "/@gradghost/s/retrieval-demo"
 * @param {string} canonicalUrl    absolute
 */
export function assembleSeriesHtml(shellHtml, row, parts, canonicalPath, canonicalUrl) {
  const pub = parts.length;
  const tot = Math.max(pub, Number(row.total) || 0);
  const mins = parts.map((p) => Math.max(1, Number(p.reading_min) || 1));
  const status = seriesStatus(row, pub, tot);
  const first = pub ? new Date(parts[0].pub_date) : null;
  const last = pub ? new Date(parts[pub - 1].pub_date) : null;
  const firstSlug = pub ? parts[0].slug : '';
  const firstHandle = pub ? parts[0].primary_handle : row.owner_handle;
  const wash = washFor(row.slug);

  const fieldLine = row.field_title
    ? `<div class="pfield"><span class="fieldline"><a href="/@${esc(row.field_owner_handle)}/f/${esc(row.field_slug)}">${esc(row.field_title)}</a></span></div>`
    : '';
  const lede = row.summary ? `<p class="lede">${esc(row.summary)}</p>` : '';

  const main =
    `<div class="wrap">`
    + `<header class="page-head">`
    + `<div class="kicker"><span class="line"></span><span class="eyebrow">Series</span></div>`
    + `<h1>${headline(row.title)}</h1>`
    + lede + fieldLine
    + `</header>`
    + `<article class="series solo">`
    + `<a class="art" href="/@${esc(firstHandle)}/${esc(firstSlug)}" aria-label="${esc('Start ' + row.title)}" style="--wx:${wash.x};--wy:${wash.y};--wo:${wash.o}">${plateSvg(mins, tot)}</a>`
    + `<div>${progHtml(pub, tot, status, first, last)}${partsHtml(parts)}</div>`
    + `</article>`
    + `</div>`;

  return shellHtml
    .split('AYSRZZTITLE').join(esc(row.title))
    .split('AYSRZZDESC').join(esc(row.summary || `${row.title} — a series in ${pub} part${pub === 1 ? '' : 's'}.`))
    .split('AYSRZZURL').join(esc(canonicalUrl))
    .split('/permalink-series-shell/').join(canonicalPath + '/')
    // FUNCTION replacement: `main` holds author-influenced titles/prose and esc() does not escape
    // `$`, so a string replacement could let a `$&`/`$'` splice shell content. Inserted verbatim.
    .replace(/<div data-shell-main[^>]*><\/div>/, () => main);
}
