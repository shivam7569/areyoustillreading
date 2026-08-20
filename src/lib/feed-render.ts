/*
 * src/lib/feed-render.ts — the shared feed-row vocabulary.
 * ---------------------------------------------------------------------------
 * The client-side helpers that render a post row in the platform feed: the
 * author monogram, byline, the reading-shape retention curve, and the series/
 * field crumb. Extracted from /blog so the homepage's "this fortnight" feed and
 * the /blog archive stream draw IDENTICAL rows from one source — no drift, no
 * duplicated 150-line curve/shape logic. Pure browser helpers (no DOM, no fetch),
 * so both pages import them into their own <script> islands.
 *
 * The retention curve is a SHAPE, never a score — a percentage on every row would
 * turn the feed into a leaderboard. The crumb renders as styled text (not links):
 * a series/field permalink is owner-scoped (/@owner/s/slug) and the feed row only
 * carries the POST author's handle, so a link here could point at the wrong owner.
 */

export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

export const initials = (name: string) => {
  const w = String(name || '').trim().split(/\s+/).filter(Boolean);
  return ((w.length >= 2 ? w[0][0] + w[1][0] : (w[0] || '?').slice(0, 2)) || '?').toUpperCase();
};

export const monthKey = (d: Date) => d.getUTCFullYear() * 12 + d.getUTCMonth();
export const monthLabel = (d: Date) => {
  const now = new Date();
  if (d.getUTCFullYear() === now.getUTCFullYear() && d.getUTCMonth() === now.getUTCMonth()) return 'This month';
  const m = d.toLocaleDateString('en-US', { month: 'long' });
  return d.getUTCFullYear() === now.getUTCFullYear() ? m : `${m} ${d.getUTCFullYear()}`;
};
export const fmtDate = (s: string) => {
  const t = Date.parse(s);
  return isNaN(t) ? '' : new Date(t).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
};
// Short "Aug 18" form the homepage aside uses.
export const fmtShort = (s: string) => {
  const t = Date.parse(s);
  return isNaN(t) ? '' : new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
// Stable per-slug seed → each post draws a fixed but varied tooltip line (feed feels human).
export const hashSeed = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h);
};
const pick = <T,>(arr: T[], seed: number) => arr[seed % arr.length];

export function byline(p: any) {
  if (p.author_count > 1 && Array.isArray(p.author_names)) {
    const names = p.author_names.filter(Boolean);
    const head = `<span class="nm">${esc(names[0])}</span>`;
    const rest = names.length === 2 ? `<span class="co">& ${esc(names[1])}</span>` : `<span class="co">& ${names.length - 1} others</span>`;
    return head + rest;
  }
  return `<span class="nm">${esc(p.primary_name)}</span>`;
}

// Pools of on-brand tooltip lines — a per-post seed picks one, so the feed reads varied, not
// templated. Tier by where the curve ends; a notch clause (with {x}) appends on a sharp drop.
const SHAPE_LINES = {
  hold: [
    'Nearly everyone who started stayed to the end',
    'The piece held its line to the bottom',
    'Few slipped away before the final paragraph',
    'Readers followed this one clean through',
    'It carried them right to the last line',
    'Attention never wavered, first word to last',
    'Almost no one set it down early',
  ],
  core: [
    'A loyal few stayed the course; the rest slipped away',
    'Held its true readers, lost the skimmers',
    'The committed stayed on while the curious wandered off partway',
    'Kept a devoted handful, let the crowd go',
    'Thinned early to a faithful core that finished it',
    'Only the invested made it to the last line',
    'Not for everyone, and the right ones knew it',
  ],
  loses: [
    'Readers drifted off well before the last line',
    'Halfway in, the room began to thin',
    'Held a crowd early, then quietly emptied out',
    'Few readers reached the closing thought',
    'Attention slipped its grip partway through',
    'Most closed the tab long before the end',
    'A slow leak from the first turn onward',
  ],
  // Position-focused (the "where"), worded to avoid echoing the tier lines' verbs.
  notch: [
    ', with the sharp fall just past {x}%',
    ', the steep drop landing near {x}%',
    ' — the break lands around {x}%',
    ' — a clean cliff at {x}%',
    '; most who left did so near {x}%',
    '; the floor gives way around {x}%',
  ],
};

// One short, engaging line for the hover tooltip — what the shape says about the reading,
// never a number as a score. {x} is a position along the piece, not a retention figure.
export function shapeText(samples: number[], seed: number) {
  const finish = samples[samples.length - 1] ?? 0;
  let ni = -1, md = 0;
  for (let i = 1; i < samples.length; i++) { const drop = samples[i - 1] - samples[i]; if (drop > md) { md = drop; ni = i; } }
  const bucket = finish >= 70 ? 'hold' : finish >= 45 ? 'core' : 'loses';
  const tier = pick(SHAPE_LINES[bucket], seed);
  const notch = bucket !== 'hold' && md >= 14 && ni > 0 ? pick(SHAPE_LINES.notch, (seed >> 4) + 1).replace('{x}', String(ni * 10)) : '';
  return `${tier}${notch}`;
}

// Smooth curve through the decile points (Catmull-Rom → cubic bézier), clamped inside the
// box so the line can never leave the graph however sharp the drop.
export function curveSvg(samples: number[] | undefined, seed = 0) {
  if (!samples || !samples.length) return '';
  const W = 86, top = 3.5, bot = 22.5;
  const y = (s: number) => top + (100 - clamp(s, 0, 100)) / 100 * (bot - top);
  const P = samples.map((s, i) => [+((i / (samples.length - 1)) * W).toFixed(1), +y(s).toFixed(1)]);
  const cy = (v: number) => +clamp(v, 1.5, 25).toFixed(1); // keep control points in-box too
  let d = `M${P[0][0]} ${P[0][1]}`;
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[i - 1] || P[0], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2] || P[P.length - 1];
    const c1x = +(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1), c1y = cy(p1[1] + (p2[1] - p0[1]) / 6);
    const c2x = +(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1), c2y = cy(p2[1] - (p3[1] - p1[1]) / 6);
    d += ` C${c1x} ${c1y} ${c2x} ${c2y} ${p2[0]} ${p2[1]}`;
  }
  let ni = -1, md = 0;
  for (let i = 1; i < P.length; i++) { const dd = P[i][1] - P[i - 1][1]; if (dd > md) { md = dd; ni = i; } }
  // Skip a cliff dot within 3px of either edge — overflow:hidden would clip it in half.
  const cliff = md > 3 && ni > 0 && P[ni][0] >= 3 && P[ni][0] <= 83 ? `<circle class="cliff" cx="${P[ni][0]}" cy="${P[ni][1]}" r="2.4"></circle>` : '';
  const label = esc(shapeText(samples, seed));
  return `<svg class="curve" viewBox="0 0 86 28" preserveAspectRatio="xMinYMid meet" role="img" aria-label="${label}" data-shape="${label}"><path class="fill" d="${d} L86 28 L0 28 Z"></path><path class="line" d="${d}"></path><line class="base" x1="0" y1="27" x2="86" y2="27"></line>${cliff}</svg>`;
}

// Field above, series line below (name · part · progress ticks). Rendered as styled text,
// not links (see file header). Empty when the post is standalone.
export function crumb(p: any) {
  if (!p.series_title && !p.field_title) return '';
  const field = p.field_title ? `<span class="fd">${esc(p.field_title)}</span>` : '';
  if (!p.series_title) return `<p class="pcrumb">${field}</p>`;
  let ticks = '';
  if (p.series_total && p.series_total > 0) {
    for (let k = 1; k <= p.series_total; k++) ticks += `<i class="${k === p.series_part ? 'here' : k < (p.series_part || 0) ? '' : 'todo'}"></i>`;
  }
  const pt = p.series_part != null
    ? `<span class="pt"><span class="n">Part ${esc(p.series_part)}${p.series_total ? ` of ${esc(p.series_total)}` : ''}</span>${ticks ? `<span class="ticks">${ticks}</span>` : ''}</span>`
    : '';
  return `<p class="pcrumb">${field}<span class="cr"><span class="snm">${esc(p.series_title)}</span>${pt}</span></p>`;
}
