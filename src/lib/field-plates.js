// src/lib/field-plates.js — the canonical field plate (ported verbatim from Claude Design's
// field-plates.js). Several series woven into one mark: each series is a band of five strands
// (opacity .16/.28/.5/.28/.16) sampled densely as a polyline, all pinched through concentric
// lens rings at the plate's centre. The middle strand of each band carries the series' parts as
// nodes — solid for published, a hollow ring for still to come. Geometry: viewBox 0 0 360 220,
// xMidYMid slice; the --wx/--wy/--wo wash lives on the host element.
//
// Exports drawFieldPlate(host, series, seed) and initFieldPlates(root) — call init AFTER the
// tiles are in the DOM (the shelf is client-rendered, so there is no DOMContentLoaded hook).
const W = 360, H = 220, X0 = -21.6, X1 = 381.6, STEP = 6.3;
const LX = 208.8, LY = 112;                       // the lens
const OFF = [-9, -4.5, 0, 4.5, 9];
const OP = [0.16, 0.28, 0.5, 0.28, 0.16];
const SW = [1.4, 1.4, 1.7, 1.4, 1.4];
const NS = 'http://www.w3.org/2000/svg';

function el(name, attrs) {
  const n = document.createElementNS(NS, name);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
}

function strandY(x, y0, amp, phase) {
  const t = (x - X0) / (X1 - X0);
  const base = y0 + Math.sin(t * 5.2 + phase) * amp + Math.sin(t * 11 + phase * 1.7) * amp * 0.32;
  const k = 0.62 * Math.exp(-Math.pow((x - LX) / 64, 2));   // pinch through the lens
  return base + (LY - base) * k;
}

function strand(y0, amp, phase) {
  const pts = [];
  for (let x = X0; x <= X1 + 0.01; x += STEP) pts.push(x.toFixed(1) + ' ' + strandY(x, y0, amp, phase).toFixed(1));
  return 'M' + pts.join(' L');
}

// series: [{parts, published}, …]
export function drawFieldPlate(host, series, seed) {
  seed = seed || 1;
  const svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'xMidYMid slice' });
  svg.setAttribute('aria-hidden', 'true');
  const n = series.length;
  const bands = series.map((s, i) => ({
    y0: H * (0.3 + (n === 1 ? 0.2 : (i / (n - 1)) * 0.42)),
    amp: 11 + (i % 3) * 3.5, phase: seed * 0.8 + i * 1.15, s,
  }));
  bands.forEach((b) => {
    OFF.forEach((o, k) => {
      svg.appendChild(el('path', {
        d: strand(b.y0 + o, b.amp, b.phase), fill: 'none', stroke: 'var(--accent)',
        'stroke-width': SW[k], opacity: OP[k], 'stroke-linecap': 'round',
      }));
    });
  });
  svg.appendChild(el('circle', { cx: LX, cy: LY, r: 26, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 1, opacity: '.3' }));
  svg.appendChild(el('circle', { cx: LX, cy: LY, r: 16, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 1.2, opacity: '.5' }));
  bands.forEach((b) => {
    const parts = b.s.parts, pub = b.s.published;
    for (let p = 0; p < parts; p++) {
      const x = parts === 1 ? W / 2 : 43.2 + p * (273.6 / (parts - 1));
      const y = strandY(x, b.y0, b.amp, b.phase);
      svg.appendChild(p < pub
        ? el('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: 4.2, fill: 'var(--accent)' })
        : el('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: 3.4, fill: 'var(--paper)', stroke: 'var(--accent)', 'stroke-width': 1.4, opacity: '.85' }));
    }
  });
  host.appendChild(svg);
}

// data-field-plate="parts:published,parts:published,…"
export function parseFieldPlate(spec) {
  return (spec || '').split(',').map((t) => {
    const a = t.split(':');
    return { parts: +a[0] || 0, published: a.length > 1 ? +a[1] : +a[0] };
  }).filter((s) => s.parts > 0);
}

// Draw every [data-field-plate] under root that hasn't been drawn yet.
export function initFieldPlates(root) {
  const scope = root || document;
  scope.querySelectorAll('[data-field-plate]').forEach((host, i) => {
    if (host.querySelector('svg')) return;
    const series = parseFieldPlate(host.getAttribute('data-field-plate'));
    drawFieldPlate(host, series.length ? series : [{ parts: 4, published: 3 }], i + 1);
  });
}
