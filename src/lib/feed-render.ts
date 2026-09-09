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

// Pools of hover lines — honest but INVITING. They describe the reading's shape to help a browsing reader
// decide to read, never as an autopsy of who left. A line is a BASE (by finish tier) + an OPTIONAL trailing
// CLAUSE (by drop shape). Base lines characterize the piece and the readers who stayed (no baked-in position
// or speed); a low finish is framed as a demanding/selective read for the devoted few, never as failure.
// Clauses are subject-neutral (about the piece) so ANY clause composes cleanly after ANY base.
const SHAPE_LINES = {
  // finish >= 65 — it grips broadly; celebrate the hold
  hold: [
    'It held the room to the last line',
    'Hard to set down once it takes hold',
    'It grips broadly and never loosens',
    'The kind read in one sitting',
    'A piece that carries its readers all the way',
    'It holds most of the room to the end',
    'A read that grips and rarely lets go',
    'It draws the room in and keeps it',
    'The rare piece that keeps a room leaning in',
    'It commands a room and holds it',
    'Gripping straight through, start to close',
    'A read few can walk away from',
    'It keeps its hold to the final line',
    'Broadly gripping, and it lands the ending',
    'Hard to put down once begun',
    'A firm grip from open to close',
  ],
  // finish 44-64 — a committed read that rewards investment
  core: [
    'A committed read that keeps the invested',
    'It rewards the readers who lean in',
    'The kind finished once a reader leans in',
    'Made for readers who go the distance',
    'A read that pays back the commitment',
    'Built for readers willing to stay with it',
    'It repays the ones who lean in',
    'A piece that keeps its committed readers close',
    'It keeps a devoted middle to the end',
    'A deliberate read for the committed',
    'A read that earns its committed readers',
    'It carries the committed to the end',
    'A piece that pays back the invested reader',
    'For readers willing to settle in and stay',
    'A read that favors the fully engaged',
    'The kind that lands for those who lean in',
  ],
  // finish 24-43 — demanding and selective; it rewards the devoted few
  loses: [
    'A demanding piece that rewards its readers',
    'A challenging read for real readers',
    'Selective, and generous to the few who stay',
    'A tough climb that repays the committed',
    'It repays the readers who stay with it',
    'A serious read for the few who go deep',
    'Well-earned, and rewarding for the devoted few',
    'It rewards the few who take the climb',
    'Demanding by design, generous to those who stay',
    'A deep read for the few who stay',
    'A challenging climb for serious readers',
    'Uncompromising, and it honors the few who stay',
    'It sets a high bar and rewards those who clear it',
    'Made for the reader who wants a real climb',
    'A selective read that finds its devoted readers',
    'It demands real attention and gives back in kind',
  ],
  // finish < 24 — a deep cut for the truly curious few
  empty: [
    'A deep cut for the truly curious',
    'Uncompromising, and made for the few',
    'The whole long climb, for the devoted',
    'A niche piece for the genuinely curious',
    'An uncompromising read for the rare few',
    'A deep cut that holds nothing back',
    'The long climb, kept for the committed few',
    'A demanding deep cut for real explorers',
    'A far-reaching read for the rare devoted',
    'A niche, far-reaching read for the rare few',
    'An unsparing read for real obsessives',
    'The full distance, for a devoted few',
  ],
  // Trailing clause for a single sharp fall — reframed as the piece TURNING HARDER there (a drop = it asks
  // more there), never as readers leaving. {where} is a natural position phrase (WHERE). Subject-neutral so
  // they never echo a base line's signature words (demanding / climb / steep / challenge / bar).
  cliff: [
    ' — the going gets harder {where}',
    ' — it tightens its grip {where}',
    ' — its steepest stretch comes {where}',
    '; the difficulty rises {where}',
    '; it turns uphill {where}',
    ' — the real test arrives {where}',
    '; it asks more of the reader {where}',
    ' — it digs in hardest {where}',
    ', growing thornier {where}',
    ' — it raises the stakes {where}',
    ' — its hardest passage arrives {where}',
    ' — the pace bites {where}',
  ],
  // Trailing clause for a slow, even decline — reframed as a patient, unhurried read, never readers leaking.
  steady: [
    ', a patient read the whole way down',
    ' — unhurried, and it asks for patience',
    ', steady and unhurried throughout',
    ' — a slow burn worth the patience',
    ', even and patient all the way through',
    ' — measured, and kind to the unhurried',
    ', a gradual read for the patient',
    ' — it unfolds slowly, and asks the same',
    ', slow and sure the whole way through',
    ' — quietly sure, and made for a steady reader',
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
