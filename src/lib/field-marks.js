/*
 * src/lib/field-marks.js — the ten generative field plates, parameterised by a field's real series.
 * Ported from the Claude Design "field-marks.js" so the /fields index, the field pages and Studio
 * all draw from one implementation. One strand/band/cluster per member series, one node per part,
 * solid where published + a hollow ring where still to come.
 *   host: <a data-field-mark="braid" data-field-series="5:5,5:3,4:2" style="--wx…"></a>
 * The DB stores the mark as "01".."10"; FIELD_MARK_NAMES[i] maps that to a name.
 */
const W = 360, H = 220, A = 'var(--accent)';

function ln(d, o, w, dash) { return '<path d="' + d + '" fill="none" stroke="' + A + '" stroke-width="' + (w || 1.4) + '" opacity="' + o + '" stroke-linecap="round"' + (dash ? ' stroke-dasharray="' + dash + '"' : '') + '/>'; }
function dot(x, y, r, on) {
  return on
    ? '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + A + '"/>'
    : '<circle cx="' + x + '" cy="' + y + '" r="' + (r - 0.4) + '" fill="var(--paper-2)" stroke="' + A + '" stroke-width="1.3" opacity=".9"/>';
}
function poly(f, steps) { let d = '', i, t, p; steps = steps || 64; for (i = 0; i <= steps; i++) { t = i / steps; p = f(t); d += (i ? ' L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); } return d; }

const M = {};
M.braid = function (S) { let s = ''; const cy = 110, mid = (S.length - 1) / 2; S.forEach(function (se, i) { const sp = (i - mid) * 30; let k; for (k = -1; k <= 1; k++) s += ln(poly(function (t) { return [-20 + 400 * t, cy + (sp + k * 5) * Math.pow(Math.abs(2 * t - 1), 1.25)]; }), k ? 0.2 : 0.45, k ? 1.2 : 1.6); for (k = 0; k < se.n; k++) { const t = (k + 1) / (se.n + 1), x = -20 + 400 * t, y = cy + sp * Math.pow(Math.abs(2 * t - 1), 1.25); s += dot(x, y, 4.4, k < se.pub); } }); return s + '<circle cx="180" cy="' + cy + '" r="17" fill="none" stroke="' + A + '" stroke-width="1.2" opacity=".5"/>'; };
M.confluence = function (S) { let s = ''; const cy = 110, mid = (S.length - 1) / 2; function g(t) { return t < 0.36 ? (0.36 - t) / 0.36 : t > 0.64 ? (t - 0.64) / 0.36 : 0; } S.forEach(function (se, i) { const sp = (i - mid) * 34; let k; for (k = -1; k <= 1; k++) s += ln(poly(function (t) { return [-20 + 400 * t, cy + (sp + k * 4.5) * g(t)]; }), k ? 0.18 : 0.42, k ? 1.1 : 1.7); for (k = 0; k < se.n; k++) { const t = (k + 1) / (se.n + 1); s += dot(-20 + 400 * t, cy + sp * g(t), 4.4, k < se.pub); } }); return s + ln('M126 ' + (cy - 26) + ' L126 ' + (cy + 26), 0.3, 1) + ln('M234 ' + (cy - 26) + ' L234 ' + (cy + 26), 0.3, 1); };
M.constellation = function (S) { let s = ''; const n = S.length, c = []; for (let j = 0; j < n; j++) c.push([n === 1 ? 180 : 88 + j * (200 / Math.max(1, n - 1)), j % 2 ? 146 : 74]); s += ln('M' + c.map(function (p) { return p[0] + ' ' + p[1]; }).join(' L'), 0.3, 1.1, '5 6'); S.forEach(function (se, i) { const cx = c[i][0], cy = c[i][1]; let k; s += '<circle cx="' + cx + '" cy="' + cy + '" r="30" fill="none" stroke="' + A + '" stroke-width="1" opacity=".22"/>'; for (k = 0; k < se.n; k++) { const a = -Math.PI / 2 + k / se.n * Math.PI * 2, x = cx + Math.cos(a) * 30, y = cy + Math.sin(a) * 30; s += ln('M' + cx + ' ' + cy + ' L' + x.toFixed(1) + ' ' + y.toFixed(1), 0.26, 1) + dot(x, y, 4.2, k < se.pub); } s += dot(cx, cy, 2.4, true); }); return s; };
M.strata = function (S) { let s = ''; const gap = 176 / Math.max(1, S.length), y0 = 52 - (S.length - 3) * 12; S.forEach(function (se, i) { const y = y0 + i * gap, h = 8 + se.n * 2.2, full = 300, done = full * se.pub / se.n; let k; s += '<rect x="30" y="' + (y - h / 2) + '" width="' + full + '" height="' + h + '" rx="2" fill="none" stroke="' + A + '" stroke-width="1" opacity=".3"/>'; s += '<rect x="30" y="' + (y - h / 2) + '" width="' + done.toFixed(1) + '" height="' + h + '" rx="2" fill="' + A + '" opacity=".2"/>'; for (k = 1; k < se.n; k++) s += ln('M' + (30 + full * k / se.n) + ' ' + (y - h / 2) + ' L' + (30 + full * k / se.n) + ' ' + (y + h / 2), 0.35, 1); for (k = 0; k < se.n; k++) s += dot(30 + full * (k + 0.5) / se.n, y, 4, k < se.pub); }); return s; };
M.orbit = function (S) { let s = ''; const ox = 180, oy = 206; S.forEach(function (se, i) { const r = 58 + i * 40, a0 = Math.PI * 1.12, a1 = Math.PI * 1.88; let k; s += ln(poly(function (t) { const a = a0 + (a1 - a0) * t; return [ox + Math.cos(a) * r, oy + Math.sin(a) * r]; }, 48), 0.34, 1.5); for (k = 0; k < se.n; k++) { const a = a0 + (a1 - a0) * ((k + 0.5) / se.n); s += dot(ox + Math.cos(a) * r, oy + Math.sin(a) * r, 4.3, k < se.pub); } }); return s + dot(ox, oy, 3, true); };
M.weave = function (S) { let s = '', k, i; const step = 336 / (S.length + 1), rows = Math.max.apply(null, S.map(function (x) { return x.n; })); for (i = 0; i < S.length; i++) s += ln('M' + (12 + (i + 1) * step) + ' 18 L' + (12 + (i + 1) * step) + ' 202', 0.5, 7); for (k = 0; k < rows; k++) { const y = 40 + k * (162 / Math.max(1, rows - 1)); s += ln('M14 ' + y + ' L346 ' + y, k < rows - 1 ? 0.5 : 0.22, 3.2); } S.forEach(function (se, i2) { const x = 12 + (i2 + 1) * step; let k2; for (k2 = 0; k2 < se.n; k2++) s += dot(x, 40 + k2 * (162 / Math.max(1, rows - 1)), 4.6, k2 < se.pub); }); return s; };
M.contour = function (S) { let s = ''; const cx = 180, cy = 110; S.forEach(function (se, i) { const rx = 52 + i * 44, ry = 34 + i * 30; let k; s += ln(poly(function (t) { const a = t * Math.PI * 2; return [cx + Math.cos(a) * rx * (1 + 0.09 * Math.sin(3 * a + i)), cy + Math.sin(a) * ry * (1 + 0.09 * Math.cos(2 * a - i))]; }, 72), 0.36 - i * 0.06, 1.5); for (k = 0; k < se.n; k++) { const a = -Math.PI / 2 + k / se.n * Math.PI * 2; s += dot(cx + Math.cos(a) * rx * (1 + 0.09 * Math.sin(3 * a + i)), cy + Math.sin(a) * ry * (1 + 0.09 * Math.cos(2 * a - i)), 4.2, k < se.pub); } }); return s; };
M.sheaf = function (S) { let s = ''; const ox = 44, oy = 110, rows = []; let i; S.forEach(function (se, si) { for (i = 0; i < se.n; i++) rows.push({ si: si, on: i < se.pub }); }); rows.forEach(function (r, k) { const y = rows.length > 1 ? 26 + k * (168 / (rows.length - 1)) : oy; s += ln(poly(function (t) { return [ox + (330 - ox) * t, oy + (y - oy) * Math.pow(t, 0.72)]; }, 40), r.on ? 0.42 : 0.2, 1.4) + dot(332, y, 4.2, r.on); }); return s + '<rect x="' + (ox - 7) + '" y="72" width="7" height="76" rx="2" fill="' + A + '" opacity=".55"/>'; };
M.tide = function (S) { let s = ''; const cy = 112; S.forEach(function (se, i) { const amp = 26 - i * 6, ph = i * 0.34; let k; s += ln(poly(function (t) { return [-20 + 400 * t, cy + amp * Math.sin(t * Math.PI * 2 * 1.35 + ph * Math.PI)]; }), 0.4 - i * 0.06, 1.6); for (k = 0; k < se.n; k++) { const t = (k + 0.5) / se.n; s += dot(-20 + 400 * t, cy + amp * Math.sin(t * Math.PI * 2 * 1.35 + ph * Math.PI), 4.3, k < se.pub); } }); return s; };
M.rule = function (S) { let s = ''; const gap = 156 / Math.max(1, S.length), y0 = 60 - (S.length - 3) * 10; S.forEach(function (se, i) { const y = y0 + i * gap; let k; s += ln('M26 ' + y + ' L334 ' + y, 0.34, 1.2); for (k = 0; k < se.n; k++) { const x = 42 + k * (292 / se.n), on = k < se.pub, h = on ? 20 : 11; s += on ? '<rect x="' + x + '" y="' + (y - h) + '" width="7" height="' + h + '" rx="1.5" fill="' + A + '" opacity=".85"/>' : '<rect x="' + (x + 0.6) + '" y="' + (y - h) + '" width="5.8" height="' + h + '" rx="1.5" fill="none" stroke="' + A + '" stroke-width="1.2" opacity=".6"/>'; } }); return s; };

export const FIELD_MARK_NAMES = Object.keys(M); // braid, confluence, … in order → maps "01".."10"

function parse(spec) {
  return (spec || '').split(',').map(function (t) { const a = t.split(':'); return { n: +a[0] || 0, pub: a.length > 1 ? +a[1] : +a[0] }; }).filter(function (x) { return x.n > 0; });
}

/** Draw a field mark. `mark` may be a name ('braid') or a DB code ('01'..'10'). */
export function drawFieldMark(host, mark, S) {
  let name = mark;
  if (/^\d+$/.test(String(mark))) name = FIELD_MARK_NAMES[(parseInt(mark, 10) - 1) % FIELD_MARK_NAMES.length] || 'braid';
  const fn = M[name] || M.braid;
  host.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' + fn(S.length ? S : [{ n: 4, pub: 3 }, { n: 3, pub: 2 }]) + '</svg>';
}

/** Draw every [data-field-mark] under `root` (data-field-series = "total:pub,total:pub,…"). */
export function initFieldMarks(root = document) {
  root.querySelectorAll('[data-field-mark]').forEach((host) => {
    if (host.querySelector('svg')) return;
    drawFieldMark(host, host.getAttribute('data-field-mark'), parse(host.getAttribute('data-field-series')));
  });
}
