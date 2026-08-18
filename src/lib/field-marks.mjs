/*
 * =============================================================================
 * src/lib/field-marks.mjs — the 10 generative "field marks"
 * =============================================================================
 * Ported from the Claude Design "Field marks" study (editorial/field-marks.html).
 * A field mark is the plate one level above the series plate: instead of one comb,
 * it draws one strand / band / cluster per member SERIES, so a denser field reads
 * as denser art without counting anything. Every mark is a pure function of the
 * field's own data — `S = [{ n, pub }, …]`, one entry per series (n = parts,
 * pub = published) — so changing the field redraws the mark. Vocabulary matches
 * the series plate: solid node = published part, hollow ring = still to come.
 *
 * FIT-TO-COUNT: every generator lays its per-series elements out relative to the
 * number of series (and, where relevant, the max parts), so a field of any size
 * (2..~8 series) stays inside the 360×220 viewBox — nothing is silently clipped.
 * The design mocks were tuned for a 3-series field; these keep the 2- and 3-series
 * look while scaling gracefully past it.
 *
 * This mirrors src/lib/plates.mjs (the Projects picker): the author selects a mark
 * by id in the Studio; the chosen one is inlined as static SVG at build. The only
 * difference is that a field mark is DRAWN from data rather than a fixed string.
 */

const W = 360, H = 220, A = 'var(--accent)';

function ln(d, o, w, dash) {
  return '<path d="' + d + '" fill="none" stroke="' + A + '" stroke-width="' + (w || 1.4) + '" opacity="' + o + '" stroke-linecap="round"' + (dash ? ' stroke-dasharray="' + dash + '"' : '') + '/>';
}
function dot(x, y, r, on) {
  return on
    ? '<circle cx="' + (+x).toFixed(1) + '" cy="' + (+y).toFixed(1) + '" r="' + r + '" fill="' + A + '"/>'
    : '<circle cx="' + (+x).toFixed(1) + '" cy="' + (+y).toFixed(1) + '" r="' + (r - 0.4) + '" fill="var(--paper-2)" stroke="' + A + '" stroke-width="1.3" opacity=".9"/>';
}
function poly(f, steps) {
  let d = '', i, t, p; steps = steps || 64;
  for (i = 0; i <= steps; i++) { t = i / steps; p = f(t); d += (i ? ' L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }
  return d;
}
function wrap(inner) {
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' + inner + '</svg>';
}

const M = {
  // 01 — braid: strands pinch to a shared waist and part again. Offsets are centred
  // on the waist and the step shrinks with count, so N strands always fit.
  braid(S) {
    let s = ''; const cy = 110, n = S.length, step = Math.min(30, 150 / Math.max(1, n - 1));
    S.forEach(function (se, i) {
      const sp = (i - (n - 1) / 2) * step; let k;
      for (k = -1; k <= 1; k++) s += ln(poly(function (t) { return [-20 + 400 * t, cy + (sp + k * 5) * Math.pow(Math.abs(2 * t - 1), 1.25)]; }), k ? 0.2 : 0.45, k ? 1.2 : 1.6);
      for (k = 0; k < se.n; k++) { const t = (k + 1) / (se.n + 1), x = -20 + 400 * t, y = cy + sp * Math.pow(Math.abs(2 * t - 1), 1.25); s += dot(x, y, 4.4, k < se.pub); }
    });
    s += '<circle cx="180" cy="' + cy + '" r="17" fill="none" stroke="' + A + '" stroke-width="1.2" opacity=".5"/>';
    return s;
  },

  // 02 — confluence: separate channels join into one, then continue together
  confluence(S) {
    let s = ''; const cy = 110, n = S.length, step = Math.min(34, 160 / Math.max(1, n - 1));
    function g(t) { return t < 0.36 ? (0.36 - t) / 0.36 : t > 0.64 ? (t - 0.64) / 0.36 : 0; }
    S.forEach(function (se, i) {
      const sp = (i - (n - 1) / 2) * step; let k;
      for (k = -1; k <= 1; k++) s += ln(poly(function (t) { return [-20 + 400 * t, cy + (sp + k * 4.5) * g(t)]; }), k ? 0.18 : 0.42, k ? 1.1 : 1.7);
      for (k = 0; k < se.n; k++) { const t = (k + 1) / (se.n + 1), x = -20 + 400 * t; s += dot(x, cy + sp * g(t), 4.4, k < se.pub); }
    });
    s += ln('M126 ' + (cy - 26) + ' L126 ' + (cy + 26), 0.3, 1) + ln('M234 ' + (cy - 26) + ' L234 ' + (cy + 26), 0.3, 1);
    return s;
  },

  // 03 — constellation: each series a cluster, clusters faintly linked. Centres are
  // generated along a gentle zigzag for however many series there are.
  constellation(S) {
    let s = ''; const n = S.length;
    const centers = S.map(function (_, i) { return [n > 1 ? 60 + i * (240 / (n - 1)) : 180, 74 + (i % 2 ? 72 : 0)]; });
    let pathD = ''; centers.forEach(function (c, i) { pathD += (i ? ' L' : 'M') + c[0].toFixed(1) + ' ' + c[1]; });
    s += ln(pathD, 0.3, 1.1, '5 6');
    S.forEach(function (se, i) {
      const cx = centers[i][0], cy = centers[i][1]; let k;
      s += '<circle cx="' + cx.toFixed(1) + '" cy="' + cy + '" r="26" fill="none" stroke="' + A + '" stroke-width="1" opacity=".22"/>';
      for (k = 0; k < se.n; k++) { const a = -Math.PI / 2 + k / se.n * Math.PI * 2, x = cx + Math.cos(a) * 26, y = cy + Math.sin(a) * 26; s += ln('M' + cx.toFixed(1) + ' ' + cy + ' L' + x.toFixed(1) + ' ' + y.toFixed(1), 0.26, 1); s += dot(x, y, 4.2, k < se.pub); }
      s += dot(cx, cy, 2.4, true);
    });
    return s;
  },

  // 04 — strata: one band per series, thickness by length, filled by progress.
  // Bands are spread across a fixed vertical window so any count fits.
  strata(S) {
    let s = ''; const n = S.length, top = 42, bot = 178;
    S.forEach(function (se, i) {
      const y = n > 1 ? top + i * ((bot - top) / (n - 1)) : (top + bot) / 2;
      const h = Math.min(24, 8 + se.n * 2.2), full = 300, done = full * se.pub / se.n; let k;
      s += '<rect x="30" y="' + (y - h / 2).toFixed(1) + '" width="' + full + '" height="' + h.toFixed(1) + '" rx="2" fill="none" stroke="' + A + '" stroke-width="1" opacity=".3"/>';
      s += '<rect x="30" y="' + (y - h / 2).toFixed(1) + '" width="' + done.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="2" fill="' + A + '" opacity=".2"/>';
      for (k = 1; k < se.n; k++) s += ln('M' + (30 + full * k / se.n) + ' ' + (y - h / 2).toFixed(1) + ' L' + (30 + full * k / se.n) + ' ' + (y + h / 2).toFixed(1), 0.35, 1);
      for (k = 0; k < se.n; k++) s += dot(30 + full * (k + 0.5) / se.n, y, 4, k < se.pub);
    });
    return s;
  },

  // 05 — orbit: concentric arcs, one per series; the radius step shrinks with count
  // so the outermost arc stays on canvas.
  orbit(S) {
    let s = ''; const ox = 180, oy = 206, n = S.length, rStep = n > 1 ? Math.min(40, 98 / (n - 1)) : 0;
    S.forEach(function (se, i) {
      const r = 52 + i * rStep, a0 = Math.PI * 1.12, a1 = Math.PI * 1.88; let k;
      s += ln(poly(function (t) { const a = a0 + (a1 - a0) * t; return [ox + Math.cos(a) * r, oy + Math.sin(a) * r]; }, 48), 0.34, 1.5);
      for (k = 0; k < se.n; k++) { const a = a0 + (a1 - a0) * ((k + 0.5) / se.n); s += dot(ox + Math.cos(a) * r, oy + Math.sin(a) * r, 4.3, k < se.pub); }
    });
    s += dot(ox, oy, 3, true);
    return s;
  },

  // 06 — weave: series as warp (spread across the width), parts as weft (rows sized
  // to the longest series). Every warp and node stays inside the canvas.
  weave(S) {
    let s = ''; const n = S.length, maxN = Math.max.apply(null, S.map(function (x) { return x.n; }).concat([1]));
    const rows = maxN, y0 = 30, y1 = 190;
    const rowY = function (k) { return rows > 1 ? y0 + k * ((y1 - y0) / (rows - 1)) : (y0 + y1) / 2; };
    const colX = function (i) { return n > 1 ? 50 + i * (260 / (n - 1)) : 180; };
    let i, k;
    for (i = 0; i < n; i++) { const x = colX(i); s += ln('M' + x.toFixed(1) + ' 18 L' + x.toFixed(1) + ' 202', 0.5, 7); }
    for (k = 0; k < rows; k++) { const y = rowY(k); s += ln('M14 ' + y.toFixed(1) + ' L346 ' + y.toFixed(1), k < Math.ceil(rows * 0.6) ? 0.5 : 0.22, 3.2); }
    S.forEach(function (se, idx) { const x = colX(idx); let k2; for (k2 = 0; k2 < se.n; k2++) s += dot(x, rowY(k2), 4.6, k2 < se.pub); });
    return s;
  },

  // 07 — contour: nested rings; both radii steps shrink with count so the outermost
  // ring stays within the frame.
  contour(S) {
    let s = ''; const cx = 180, cy = 110, n = S.length;
    const rxStep = n > 1 ? Math.min(44, 98 / (n - 1)) : 0, ryStep = n > 1 ? Math.min(30, 61 / (n - 1)) : 0;
    S.forEach(function (se, i) {
      const rx = 52 + i * rxStep, ry = 34 + i * ryStep; let k;
      s += ln(poly(function (t) { const a = t * Math.PI * 2; return [cx + Math.cos(a) * rx * (1 + 0.09 * Math.sin(3 * a + i)), cy + Math.sin(a) * ry * (1 + 0.09 * Math.cos(2 * a - i))]; }, 72), Math.max(0.08, 0.36 - i * 0.05), 1.5);
      for (k = 0; k < se.n; k++) { const a = -Math.PI / 2 + k / se.n * Math.PI * 2; s += dot(cx + Math.cos(a) * rx * (1 + 0.09 * Math.sin(3 * a + i)), cy + Math.sin(a) * ry * (1 + 0.09 * Math.cos(2 * a - i)), 4.2, k < se.pub); }
    });
    return s;
  },

  // 08 — sheaf: everything bound at one spine and fanning out. Rows = total parts,
  // spread across the height, so it scales with the whole field.
  sheaf(S) {
    let s = ''; const ox = 44, oy = 110, rows = []; let i;
    S.forEach(function (se, si) { for (i = 0; i < se.n; i++) rows.push({ si: si, on: i < se.pub }); });
    const n = Math.max(1, rows.length - 1);
    rows.forEach(function (r, k) {
      const y = 26 + k * (168 / n);
      s += ln(poly(function (t) { return [ox + (330 - ox) * t, oy + (y - oy) * Math.pow(t, 0.72)]; }, 40), r.on ? 0.42 : 0.2, 1.4);
      s += dot(332, y, 4.2, r.on);
    });
    s += '<rect x="' + (ox - 7) + '" y="72" width="7" height="76" rx="2" fill="' + A + '" opacity=".55"/>';
    return s;
  },

  // 09 — tide: waves out of phase, nodes riding the crests. Amplitude tapers with
  // index so it never leaves the band (stays within cy ± ~26).
  tide(S) {
    let s = ''; const cy = 112, n = S.length;
    S.forEach(function (se, i) {
      const amp = 26 - (n > 1 ? i * (20 / (n - 1)) : 0), ph = i * 0.34; let k;
      s += ln(poly(function (t) { return [-20 + 400 * t, cy + amp * Math.sin(t * Math.PI * 2 * 1.35 + ph * Math.PI)]; }), Math.max(0.14, 0.4 - i * 0.05), 1.6);
      for (k = 0; k < se.n; k++) { const t = (k + 0.5) / se.n; s += dot(-20 + 400 * t, cy + amp * Math.sin(t * Math.PI * 2 * 1.35 + ph * Math.PI), 4.3, k < se.pub); }
    });
    return s;
  },

  // 10 — rule: rails with set rules standing on them; rails spread across a fixed
  // vertical window so any count fits.
  rule(S) {
    let s = ''; const n = S.length;
    S.forEach(function (se, i) {
      const y = n > 1 ? 40 + i * (150 / (n - 1)) : 115; let k;
      s += ln('M26 ' + y.toFixed(1) + ' L334 ' + y.toFixed(1), 0.34, 1.2);
      for (k = 0; k < se.n; k++) {
        const x = 42 + k * (292 / se.n), on = k < se.pub, h = on ? 20 : 11;
        s += on
          ? '<rect x="' + x.toFixed(1) + '" y="' + (y - h).toFixed(1) + '" width="7" height="' + h + '" rx="1.5" fill="' + A + '" opacity=".85"/>'
          : '<rect x="' + (x + 0.6).toFixed(1) + '" y="' + (y - h).toFixed(1) + '" width="5.8" height="' + h + '" rx="1.5" fill="none" stroke="' + A + '" stroke-width="1.2" opacity=".6"/>';
      }
    });
    return s;
  },
};

// The catalogue — id + display name + the argument each mark makes about what a
// field IS. Order = the Studio swatch order. `fn` keys into M above.
export const FIELD_MARKS = [
  { id: '01', name: 'Braid', fn: 'braid', note: 'Strands run apart, pinch to a shared waist, and separate again — the ring marks where separate arguments become one subject.' },
  { id: '02', name: 'Confluence', fn: 'confluence', note: 'Channels that merge and stay merged — a field as where several lines of thought end up flowing together.' },
  { id: '03', name: 'Constellation', fn: 'constellation', note: 'Each series a small cluster of its parts; the dashed line is the eye joining them.' },
  { id: '04', name: 'Strata', fn: 'strata', note: 'Bands stacked like sediment — thickness is length, the tinted run is how much is published.' },
  { id: '05', name: 'Orbit', fn: 'orbit', note: 'Concentric arcs from one origin — distance from the centre is reading order.' },
  { id: '06', name: 'Weave', fn: 'weave', note: 'Warp of series against weft of parts — a field made of crossings.' },
  { id: '07', name: 'Contour', fn: 'contour', note: 'Nested contours, like a map of raised ground — the field as terrain.' },
  { id: '08', name: 'Sheaf', fn: 'sheaf', note: 'Everything bound at one spine and fanning out — the bar is the binding, not the pages.' },
  { id: '09', name: 'Tide', fn: 'tide', note: 'Waves out of phase, nodes riding their crests — closest in feel to the series plate.' },
  { id: '10', name: 'Rule', fn: 'rule', note: 'Rails with set rules standing on them, like furniture on a page grid — no metaphor at all.' },
];

// Representative data for the Studio swatches (three series of five, five and four).
export const PREVIEW_S = [{ n: 5, pub: 5 }, { n: 5, pub: 3 }, { n: 4, pub: 2 }];

export function fieldMark(id) {
  return FIELD_MARKS.find((m) => m.id === id) || FIELD_MARKS[0];
}

// The whole mark as an inline <svg>, drawn from the field's own series data `S`.
export function markSvg(id, S) {
  const m = fieldMark(id);
  const data = Array.isArray(S) && S.length ? S : PREVIEW_S;
  return wrap(M[m.fn](data));
}
