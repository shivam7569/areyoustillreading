/*
 * src/lib/series-plates.js — the fluid comb-and-spine series mark, generated (not pasted).
 * Ported verbatim from the Claude Design "series-plates.js" so the icon matches the design and the
 * detail pages: a slow wide comb at three curves per part (a long series reads as denser silk), a
 * spine whose height at each node is that part's reading time, SOLID dots for published parts and
 * HOLLOW rings for planned ones, and a dashed tail past the last published part (unwritten parts
 * have no time yet). Host: <span data-series-plate="12,13,18,0,0" data-published="3" style="--wx…">.
 */
const NS = 'http://www.w3.org/2000/svg';
const W = 300, H = 200, X0 = -10, X1 = 310;

function el(n, a) { const e = document.createElementNS(NS, n); for (const k in a) e.setAttribute(k, a[k]); return e; }

// one comb curve: a long shallow arc that sags then lifts, sampled densely so it reads as drawn
function comb(y0, amp, phase) {
  const pts = [];
  for (let x = X0; x <= X1; x += 10) {
    const t = (x - X0) / (X1 - X0);
    pts.push([x, y0 + Math.sin(t * Math.PI + phase) * amp - t * 10]);
  }
  let d = 'M' + pts[0][0] + ' ' + pts[0][1].toFixed(1);
  for (let i = 1; i < pts.length; i++) d += ' L' + pts[i][0] + ' ' + pts[i][1].toFixed(1);
  return d;
}

export function drawSeriesPlate(host, mins, published) {
  const n = mins.length, svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'xMidYMid slice' });
  svg.setAttribute('aria-hidden', 'true');
  const rows = Math.max(6, n * 3);                 // comb: three curves per part → density = length of the run
  for (let i = 0; i < rows; i++) {
    svg.appendChild(el('path', {
      d: comb(24 + i * (150 / rows), 9 + (i % 3) * 4, i * 0.34),
      fill: 'none', stroke: 'var(--accent)', 'stroke-width': i % 3 === 0 ? 1.7 : 1.6, opacity: 0.4,
    }));
  }
  // spine: node height from each part's reading time, flat past the last published part
  const known = mins.slice(0, published).filter((m) => m > 0);
  const top = Math.max.apply(null, known.concat([1]));
  const last = known.length ? known[known.length - 1] : 1;
  const pts = mins.map((m, i) => {
    const v = i < published && m > 0 ? m : last;
    return [n === 1 ? W / 2 : 34 + i * ((W - 68) / (n - 1)), 168 - (v / top) * 84];
  });
  const seg = (a, b) => 'M' + pts[a].map((v) => v.toFixed(1)).join(' ') + ' L' + pts[b].map((v) => v.toFixed(1)).join(' ');
  for (let s = 0; s < pts.length - 1; s++) {
    const future = s + 1 >= published;
    svg.appendChild(el('path', Object.assign(
      { d: seg(s, s + 1), fill: 'none', stroke: 'var(--accent)', 'stroke-width': 1.8, 'stroke-linecap': 'round' },
      future ? { 'stroke-dasharray': '5 5', opacity: 0.5 } : { opacity: 0.85 },
    )));
  }
  pts.forEach((p, i) => {
    svg.appendChild(i < published
      ? el('circle', { cx: p[0].toFixed(1), cy: p[1].toFixed(1), r: 4.6, fill: 'var(--accent)' })
      : el('circle', { cx: p[0].toFixed(1), cy: p[1].toFixed(1), r: 3.8, fill: 'var(--paper)', stroke: 'var(--accent)', 'stroke-width': 1.5, opacity: 0.85 }));
  });
  host.appendChild(svg);
}

/** Draw every [data-series-plate] under `root` that hasn't been drawn yet. */
export function initSeriesPlates(root = document) {
  root.querySelectorAll('[data-series-plate]').forEach((host) => {
    if (host.querySelector('svg')) return;
    const mins = host.getAttribute('data-series-plate').split(',').map(Number);
    drawSeriesPlate(host, mins, +host.getAttribute('data-published') || mins.length);
  });
}
