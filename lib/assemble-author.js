/**
 * lib/assemble-author.js — assemble the /@handle author page from permalink-author-shell.
 * Builds each section's HTML from the author RPCs and injects into the shell's sentinels.
 * Pure string work (no DOM), like assemble-permalink.js.
 */
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// Initials from a pen name (seed for the mark; a stored mark would override once Studio ships).
function initials(name) {
  const w = String(name || '').trim().split(/[\s._-]+/).filter(Boolean);
  if (!w.length) return '—';
  return (w.length > 1 ? w[0][0] + w[1][0] : w[0].slice(0, 2)).toUpperCase();
}
const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;

// Smooth reading-shape curve (Catmull-Rom → bézier), clamped in-box. w/h set the viewBox.
function curveSvg(samples, { w = 86, h = 28, cls = '', label = '' } = {}) {
  if (!samples || !samples.length) return '';
  const top = +(h * 0.12).toFixed(1), bot = +(h * 0.85).toFixed(1);
  const y = (s) => top + (100 - clamp(s, 0, 100)) / 100 * (bot - top);
  const P = samples.map((s, i) => [+((i / (samples.length - 1)) * w).toFixed(1), +y(s).toFixed(1)]);
  const cy = (v) => +clamp(v, 1, h - 1).toFixed(1);
  let d = `M${P[0][0]} ${P[0][1]}`;
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[i - 1] || P[0], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2] || P[P.length - 1];
    const c1x = +(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1), c1y = cy(p1[1] + (p2[1] - p0[1]) / 6);
    const c2x = +(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1), c2y = cy(p2[1] - (p3[1] - p1[1]) / 6);
    d += ` C${c1x} ${c1y} ${c2x} ${c2y} ${p2[0]} ${p2[1]}`;
  }
  return `<svg class="curve ${cls}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}">`
    + `<path class="fill" d="${d} L${w} ${h} L0 ${h} Z"></path><path class="line" d="${d}"></path>`
    + `<line class="base" x1="0" y1="${h - 1}" x2="${w}" y2="${h - 1}"></line></svg>`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDate = (d) => isNaN(d.valueOf()) ? '' : `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
const ticks = (published, total, cls) => { let s = ''; for (let i = 0; i < total; i++) s += `<i class="${i < published ? '' : (cls || 'todo')}"></i>`; return s; };

// The masthead signals line + the signature reading shape (omitted when there's no data yet).
function sigHtml(stats) {
  if (!stats) return '';
  const bits = [];
  if (stats.post_count != null) bits.push(`<b>${plural(stats.post_count, 'piece')}</b>${stats.since_year ? `, published since ${stats.since_year}` : ''}.`);
  const fs = [];
  if (stats.field_count) fs.push(`<b>${plural(stats.field_count, 'field')}</b>`);
  if (stats.series_count) fs.push(`running <b>${plural(stats.series_count, 'series', 'series')}</b>`);
  if (fs.length) bits.push(`Writes in ${fs.join(', ')}.`);
  if (stats.longest_min) bits.push(`Longest piece runs <b>${plural(stats.longest_min, 'minute')}</b>.`);
  const sig = Array.isArray(stats.signature) ? stats.signature : null;
  let shape = '';
  if (sig && sig.length) {
    const finish = sig[sig.length - 1] ?? 0;
    const lab = finish >= 65 ? ['Tends to hold', 'Loses few readers early, holds to the end.']
      : finish >= 45 ? ['Keeps a core', 'Sheds the curious, keeps its readers to the end.']
        : ['Asks a lot', 'Loses many early and rewards the ones who stay.'];
    shape = `<div class="shape"><span class="lab">${esc(lab[0])}<small>${esc(lab[1])}</small></span>`
      + curveSvg(sig, { w: 214, h: 66, cls: 'sig', label: `Signature reading shape: ${lab[1]}` }) + `</div>`;
  }
  return `<p class="msig">${bits.join('<br>')}</p>${shape}`;
}

// One field chip: generative plate (drawn client-side from data-field-plate) + nested series.
const WASH = [[20, 12, 12], [78, 80, 11], [50, 20, 12], [30, 72, 12]];
function fieldChip(f, i, handle, extra) {
  const series = Array.isArray(f.series) ? f.series : [];
  const spec = series.map((s) => `${s.total || 0}:${s.published || 0}`).join(',');
  const w = WASH[i % WASH.length];
  const nest = series.map((s) => `<li><span class="t">${esc(s.title)}</span><span class="tk">${ticks(s.published || 0, s.total || 0)}</span></li>`).join('');
  // A shared field (this author contributed a series but doesn't run it) links to its OWNER's
  // permalink and is marked as such — mirroring how contributed series carry a note (decision 12).
  const ownerHandle = f.owner_handle || handle;
  const shared = f.is_owner === false;
  return `<a class="fchip${extra ? ' extra' : ''}" href="/@${esc(ownerHandle)}/f/${esc(f.slug)}">`
    + `<span class="plate" data-field-plate="${esc(spec)}" style="--wx:${w[0]}%;--wy:${w[1]}%;--wo:${w[2]}%"></span>`
    + `<div class="fb"><h3>${esc(f.title)}</h3>`
    + `<span class="sl">${plural(f.series_count, 'series', 'series')} · ${f.published_parts} of ${f.total_parts} parts published${shared && f.owner_name ? ` · with ${esc(f.owner_name)}` : ''}</span>`
    + (nest ? `<ul class="snest">${nest}</ul>` : '') + `</div></a>`;
}

function seriesCard(s, extra) {
  const complete = s.published >= s.total;
  const foot = complete ? `${plural(s.total, 'part')} · complete` : `${s.published} of ${plural(s.total, 'part')}${s.status === 'paused' ? ' · paused' : ''}`;
  return `<article class="scard${extra ? ' extra' : ''}">`
    + (s.field_title ? `<div class="in">${esc(s.field_title)}</div>` : '')
    + `<h3><a href="/@${esc(s.start_owner_handle)}/s/${esc(s.slug)}">${esc(s.title)}</a></h3>`
    + (s.summary ? `<p>${esc(s.summary)}</p>` : '')
    + `<div class="sp">${ticks(s.published, s.total)}</div>`
    + `<div class="foot"><span>${esc(foot)}</span>${s.start_slug ? `<a class="go" href="/@${esc(s.start_handle)}/${esc(s.start_slug)}">Start with part one &rarr;</a>` : ''}</div></article>`;
}

function workRow(p, retention) {
  const tags = (p.tags || []).slice(0, 4).map((t) => `<span class="tag">${esc(t)}</span>`).join('');
  const curve = curveSvg(retention[p.slug], { w: 86, h: 28, label: 'Reading shape' });
  return `<article class="post"><div class="pmain"><span class="picon" aria-hidden="true"></span><div class="ptext">`
    + `<h3><a href="/@${esc(p.primary_handle)}/${esc(p.slug)}">${esc(p.title)}</a></h3>`
    + (p.description ? `<p class="sum">${esc(p.description)}</p>` : '')
    + (tags ? `<div class="tags">${tags}</div>` : '')
    + `</div></div><div class="aside"><span class="date">${esc(fmtDate(new Date(p.pub_date)))}</span><span class="rt" data-read-min="${esc(p.reading_min || 1)}" data-read-unit="min">${esc(p.reading_min || 1)} min</span>${curve}</div></article>`;
}

function workHtml(posts, retention) {
  if (!posts || !posts.length) {
    return `<div class="slab"><span class="eyebrow">Published work</span><span class="line"></span></div>`
      + `<div class="blank"><span class="art" aria-hidden="true"></span><div class="bt"><h3>Nothing published yet.</h3>`
      + `<p>They've set up their page but haven't published a piece. Follow the letter to hear when the first one lands.</p></div></div>`;
  }
  const byYear = new Map();
  for (const p of posts) { const y = new Date(p.pub_date).getUTCFullYear() || '—'; if (!byYear.has(y)) byYear.set(y, []); byYear.get(y).push(p); }
  let out = `<div class="slab"><span class="eyebrow">Published work</span><span class="line"></span><span class="more-link">Newest first, never ranked</span></div>`;
  for (const y of [...byYear.keys()].sort((a, b) => b - a)) {
    out += `<div class="yr"><h2>${esc(y)}</h2><span class="rule"></span></div><div class="post-list">${byYear.get(y).map((p) => workRow(p, retention)).join('')}</div>`;
  }
  return out;
}

/**
 * @param {string} shellHtml  fetched /permalink-author-shell HTML
 * @param {object} d          { author, stats, fields, series, posts, retention, path, url }
 * @returns {string} full page HTML
 */
export function assembleAuthorHtml(shellHtml, d) {
  const a = d.author || {};
  const name = a.pen_name || a.handle || 'Author';
  const mark = initials(name);
  const bio = a.bio ? `<p class="bio">${esc(a.bio)}</p>` : '';
  const bioDesc = a.bio || `${name} on areyoustillreading — their published work, fields and series.`;

  const owned = (d.series || []).filter((s) => s.is_owner);
  const contrib = (d.series || []).filter((s) => !s.is_owner);
  const fields = d.fields || [];
  const FSHOW = 2;

  const fieldsHtml = fields.map((f, i) => fieldChip(f, i, a.handle, i >= FSHOW)).join('');
  const seriesHtml = owned.map((s, i) => seriesCard(s, i >= FSHOW)).join('');
  const snoteHtml = contrib.length
    ? `<p class="snote">Also wrote in ${contrib.map((s) => `<a href="/@${esc(s.start_owner_handle)}/s/${esc(s.slug)}">${esc(s.title)}</a>`).join(', ')} — ${contrib.length === 1 ? 'a series someone else runs' : 'series others run'}.</p>`
    : '';
  const deviceHtml = a.avatar_url
    ? `<span class="device" data-shell-device><img src="${esc(a.avatar_url)}" alt=""></span>`
    : null; // null → keep the shell's <b id="pdevice"> (script fills from the mark)

  let html = shellHtml
    .split('AYSRZZTITLE').join(esc(name))
    .split('AYSRZZBIODESC').join(esc(bioDesc))
    .split('AYSRZZNAME').join(esc(name))
    .split('AYSRZZHANDLE').join(esc(a.handle || ''))
    .split('AYSRZZMARK').join(esc(mark))
    // ONLY the trailing-slash form is the canonical/og URL; the bare form is the hashed CSS
    // asset filename (/_astro/permalink-author-shell.HASH.css) — replacing it 404s the styles.
    .split('/permalink-author-shell/').join(d.path + '/')
    // FUNCTION replacements: these inject author-influenced HTML (bio, field/series/post titles),
    // and esc() does not escape `$`, so a string replacement would let a `$&`/`$'` splice shell
    // content. A function return is inserted verbatim.
    .replace(/<div data-shell-bio[^>]*><\/div>/, () => bio)
    .replace(/<div class="mrow"[^>]*data-shell-sig[^>]*><\/div>/, () => `<div class="mrow">${sigHtml(d.stats)}</div>`)
    .replace(/<div class="fgrid" id="fchips"[^>]*data-shell-fields[^>]*><\/div>/, () => `<div class="fgrid" id="fchips">${fieldsHtml}</div>`)
    .replace(/<div class="sgrid" id="sgrid"[^>]*data-shell-series[^>]*><\/div>/, () => `<div class="sgrid" id="sgrid">${seriesHtml}</div>`)
    .replace(/<div data-shell-snote[^>]*><\/div>/, () => snoteHtml)
    .replace(/<section class="worksec" data-shell-work[^>]*><\/section>/, () => `<section class="worksec">${workHtml(d.posts, d.retention || {})}</section>`);

  // Show the "Writes in" / "Series they run" bands only when they have content; reveal the
  // expand buttons only when there are more than two items.
  if (fields.length) html = html.replace(/(<section class="fband"[^>]*) hidden(>)/, '$1$2');
  if (owned.length) html = html.replace(/(<section class="sband"[^>]*) hidden(>)/, '$1$2');
  if (fields.length > FSHOW) html = html.replace(/(<button class="xbtn"[^>]*data-shell-fxbtn[^>]*) hidden(>)/, `$1$2`).replace('data-shell-fxbtn>Show all', `data-shell-fxbtn>Show all ${fields.length} fields`);
  if (owned.length > FSHOW) html = html.replace(/(<button class="xbtn"[^>]*data-shell-sxbtn[^>]*) hidden(>)/, `$1$2`).replace('data-shell-sxbtn>Show all', `data-shell-sxbtn>Show all ${owned.length}`);
  if (deviceHtml) html = html.replace(/<span class="device"[^>]*data-shell-device[^>]*><b id="pdevice"><\/b><\/span>/, () => deviceHtml);

  return html;
}
