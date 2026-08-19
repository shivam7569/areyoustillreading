/**
 * lib/assemble-field.js — assemble a DB FIELD page from the permalink-field-shell donor.
 *
 * Given the fetched /permalink-field-shell HTML + a get_public_field row + its list_field_series
 * rows + each member series' list_series_posts, returns the full /@handle/f/slug page HTML: the
 * arc across the field (reading order + a place to start), the field's generative mark, then each
 * member series rendered as the SAME silk-plate card the /fields/<slug> page uses. Mirrors the
 * built src/pages/fields/[slug].astro so a DB field looks byte-identical.
 */
import { markSvg } from '../src/lib/field-marks.mjs';
import { washFor } from '../src/lib/series-plate.mjs';
import { headline, plateSvg, progHtml, partsHtml, seriesStatus } from './assemble-series.js';

const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const STATUS_WORD = { 'in-progress': 'running', complete: 'complete', paused: 'paused' };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// "Complete · 5 parts" for a finished series, else "Running · 3 of 5".
function stepLabel(status, pub, tot) {
  return status === 'complete' ? `Complete · ${tot} part${tot === 1 ? '' : 's'}` : `${cap(STATUS_WORD[status] || 'running')} · ${pub} of ${tot}`;
}

/**
 * @param {string}  shellHtml       fetched /permalink-field-shell HTML
 * @param {object}  field           one get_public_field() row
 * @param {object[]} seriesList     list_field_series() rows (ordered by field position)
 * @param {Object.<string, object[]>} partsBySeries  series_slug → list_series_posts rows
 * @param {string}  canonicalPath   e.g. "/@gradghost/f/ml-in-production"
 * @param {string}  canonicalUrl    absolute
 */
export function assembleFieldHtml(shellHtml, field, seriesList, partsBySeries, canonicalPath, canonicalUrl) {
  // Per-series display model (parts, counts, derived status), computed once.
  const model = seriesList.map((s) => {
    const parts = partsBySeries[s.series_slug] || [];
    const pub = parts.length;
    const tot = Math.max(pub, Number(s.total) || 0);
    const status = seriesStatus({ status: null, total: s.total }, pub, tot);
    return { s, parts, pub, tot, status };
  });

  // ── the arc: each series + its part links, in reading order ──────────────────
  const arc = model.map((m, i) => {
    const aparts = m.parts.map((p) => `<li data-slug="${esc(p.slug)}"><a href="/@${esc(p.primary_handle)}/${esc(p.slug)}">${esc(p.title)}</a></li>`).join('');
    return `<li><span class="n">${String(i + 1).padStart(2, '0')}</span>`
      + `<div><span class="sname">${esc(m.s.series_title)}</span>`
      + (aparts ? `<ul class="aparts">${aparts}</ul>` : '')
      + `</div></li>`;
  }).join('');

  // ── start here: the first published part of the first series ─────────────────
  const startFirst = model.find((m) => m.parts.length);
  const startPart = startFirst ? startFirst.parts[0] : null;
  const startHref = startPart ? `/@${esc(startPart.primary_handle)}/${esc(startPart.slug)}`
    : (seriesList[0] && seriesList[0].start_handle ? `/@${esc(seriesList[0].start_handle)}/${esc(seriesList[0].start_slug)}` : '#');
  const startWhy = startPart
    ? `Begins with <b>${esc(startPart.title)}</b> — ${startPart.reading_min || 1} minute${(startPart.reading_min || 1) === 1 ? '' : 's'}, no prerequisites.`
    : '';

  // ── the field mark (one strand per member series), drawn from live counts ─────
  const wash = washFor(field.slug);
  const markData = model.map((m) => ({ n: m.tot, pub: m.pub }));

  const lede = field.summary ? `<p class="lede">${esc(field.summary)}</p>` : '';

  const hero =
    `<div class="wrap">`
    + `<header class="page-head">`
    + `<div class="kicker"><span class="line"></span><span class="eyebrow">Field</span></div>`
    + `<h1>${headline(field.title)}</h1>`
    + lede
    + `</header>`
    + `<div class="fhero">`
    + `<div>`
    + `<ol class="arc">${arc}</ol>`
    + `<div class="starthere">`
    + `<a class="btn btn-primary" href="${startHref}"><span class="sh-label">Start here</span> <span class="arrow">→</span></a>`
    + (startWhy ? `<span class="why">${startWhy}</span>` : '')
    + `</div>`
    + `</div>`
    + `<div class="fart" style="--wx:${wash.x};--wy:${wash.y};--wo:${wash.o}">${markSvg(field.mark, markData)}</div>`
    + `</div>`
    + `</div>`;

  // ── each member series as a full silk-plate card ─────────────────────────────
  const cards = model.map((m, i) => {
    const w = washFor(m.s.series_slug);
    const first = m.pub ? new Date(m.parts[0].pub_date) : null;
    const last = m.pub ? new Date(m.parts[m.pub - 1].pub_date) : null;
    const mins = m.parts.map((p) => Math.max(1, Number(p.reading_min) || 1));
    const href = `/@${esc(m.s.series_owner_handle)}/s/${esc(m.s.series_slug)}`;
    const sum = m.s.series_summary ? `<p class="sum">${esc(m.s.series_summary)}</p>` : '';
    return `<div class="ford"><span>${i === 0 ? 'First' : 'Then'}</span><span class="step">${esc(stepLabel(m.status, m.pub, m.tot))}</span></div>`
      + `<article class="series">`
      + `<a class="art" href="${href}" aria-label="${esc(m.s.series_title)}" style="--wx:${w.x};--wy:${w.y};--wo:${w.o}">${plateSvg(mins, m.tot)}</a>`
      + `<div><h2><a href="${href}">${esc(m.s.series_title)}</a></h2>${sum}`
      + progHtml(m.pub, m.tot, m.status, first, last) + partsHtml(m.parts)
      + `</div>`
      + `</article>`;
  }).join('');

  const main = hero + `<div class="wrap">${cards}</div>`;

  return shellHtml
    .split('AYSRZZTITLE').join(esc(field.title))
    .split('AYSRZZDESC').join(esc(field.summary || `A field gathering ${field.series_count} series.`))
    .split('AYSRZZURL').join(esc(canonicalUrl))
    .split('/permalink-field-shell/').join(canonicalPath + '/')
    .replace(/<div data-shell-main[^>]*><\/div>/, main);
}
