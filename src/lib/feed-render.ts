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

// Pools of on-brand tooltip lines. A per-post seed picks one, so the feed reads varied, not templated.
// A line is a BASE (chosen by how many finished) + an OPTIONAL trailing CLAUSE (chosen by the drop's
// shape): a positioned cliff, or a slow steady thinning. Base lines speak to MAGNITUDE only (how many
// stayed) and carry no baked-in position or speed, so ANY clause composes cleanly after them.
const SHAPE_LINES = {
  // finish >= 65 — most / nearly everyone reached the end
  hold: [
    'The piece held its line to the end',
    'Nearly everyone rode this one to the finish',
    'It carried the room clean through',
    'Most readers went the full distance',
    'The room barely thinned before the end',
    'Almost no one left before the last line',
    'A full house saw this one out',
    'The crowd stuck with it to the bottom',
    'The light held steady all the way down',
    'They stayed to the very last page',
    'The piece never loosened its grip',
    'A room that never emptied out',
    'It held, warm and unbroken, to the end',
    'This one held every hand it took',
    'Readers followed it through without drifting',
    'It kept its hold from start to finish',
  ],
  // finish 44-64 — about half stayed; a committed core finished
  core: [
    'About half stayed to the end',
    'It held a solid core, lost the rest',
    'A committed half carried it home',
    'It kept its true readers, let the skimmers go',
    'Half stayed the course, the rest slipped out',
    'It split the room near evenly',
    'The faithful half made it to the bottom',
    'Half went the distance, half turned back',
    'A real core finished while the others drifted',
    'The devoted stayed while the browsers left',
    'A steady half saw it through',
    'It kept a strong, loyal core',
    'Lost the passing crowd, kept the faithful half',
    'The casual left, the invested stayed',
    'It kept the readers who meant to stay',
    'Half the light stayed on to the finish',
  ],
  // finish 24-43 — a real minority finished; most drifted away
  loses: [
    'Only a minority made it to the end',
    'Most drifted off, a stubborn few finished',
    'A core held on while the rest left',
    'Most closed the tab unfinished',
    'The crowd emptied out to a faithful few',
    'A hard core saw it to the bottom',
    'The audience fell away, a real core stayed',
    'It thinned to a small, loyal knot',
    'It kept only its most patient readers',
    'The many left, the few held on',
    'It lost the crowd but kept a true few',
    'Most gave up, a faithful minority remained',
    'It shed most readers but held a real core',
    'The crowd peeled away, a loyal few reached the bottom',
    'It lost the many, kept the devoted few',
    'Most let this one go',
  ],
  // finish < 24 — almost no one finished
  empty: [
    'Almost no one reached the end',
    'The room emptied out to a handful',
    'It emptied out, barely a soul at the end',
    'Only a stray reader saw the last line',
    'Scarcely anyone made it to the bottom',
    'It bled readers until almost none remained',
    'It was all but deserted by the end',
    'It thinned to almost nothing by the close',
    'The crowd all but vanished before the end',
    'Just a lonely few remained at the end',
  ],
  // Trailing clause for a single sharp fall; {where} is filled with a natural position phrase (WHERE).
  // Subject-neutral (about the drop, not the room) so they never echo a base line's nouns.
  cliff: [
    ' — the floor gave way {where}',
    ' — the drop came {where}',
    ', with the sharp fall {where}',
    ', losing them in a single drop {where}',
    ' — dropping off a cliff {where}',
    ', with a steep fall {where}',
    ' — a sudden break {where}',
    ', falling off sharply {where}',
    '; the steep drop landed {where}',
    ' — the sharp break came {where}',
    ', the cliff coming {where}',
    ' — giving way all at once {where}',
  ],
  // Trailing clause for a slow, even decline with no cliff. Standalone.
  steady: [
    ', thinning steadily the whole way down',
    ', shedding readers at an even pace',
    ' — a slow, even leak all the way through',
    ', tapering off bit by bit',
    '; no cliff, just a gradual drift',
    ', easing out a little at every turn',
    ' — easing out step by step',
    ', growing quieter with every passage',
    '; readers slipped away bit by bit',
    ' — a slow tide going out the whole way',
  ],
};

// Where a drop lands, as a spoken phrase (never a raw percentage). Keyed by position along the read.
const WHERE: Record<string, string[]> = {
  open: ['in the opening', 'right at the start', 'in the first few paragraphs'],
  early: ['early on', 'in the first stretch', 'before it found its feet'],
  mid: ['around the midpoint', 'halfway through', 'in the middle stretch'],
  late: ['in the back half', 'deep into the piece', 'in the final third'],
  end: ['near the very end', 'just before the close', 'at the last turn'],
};
const posKey = (ni: number, n: number) => {
  const at = (ni + 0.5) / n; // reading position of the steepest drop, 0..1
  return at <= 0.22 ? 'open' : at <= 0.42 ? 'early' : at <= 0.62 ? 'mid' : at <= 0.82 ? 'late' : 'end';
};

// One short, spoken line for the hover tooltip — the shape of the reading, never a number as a score.
// A BASE line (by finish tier) + an optional CLAUSE (a positioned cliff, or a steady thinning). Seeds
// are decorrelated by bit-shifts so the base, clause, and position each vary independently per post.
export function shapeText(samples: number[], seed: number) {
  const n = samples.length;
  if (!n) return '';
  const start = samples[0] ?? 100;
  const finish = samples[n - 1] ?? 0;
  const decline = Math.max(0, start - finish);
  let ni = -1, md = 0;
  for (let i = 1; i < n; i++) { const drop = samples[i - 1] - samples[i]; if (drop > md) { md = drop; ni = i; } }

  const bucket = finish >= 65 ? 'hold' : finish >= 44 ? 'core' : finish >= 24 ? 'loses' : 'empty';
  const base = pick(SHAPE_LINES[bucket], seed);
  if (bucket === 'hold') return base; // a piece that held to the end needs no drop clause

  let clause = '';
  if (md >= 15 && ni > 0) {
    const where = pick(WHERE[posKey(ni, n)], (seed >> 3) + 1);
    clause = pick(SHAPE_LINES.cliff, (seed >> 5) + 1).replace('{where}', where);
  } else if (decline >= 22 && md < 12) {
    clause = pick(SHAPE_LINES.steady, (seed >> 4) + 1);
  }
  return `${base}${clause}`;
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
