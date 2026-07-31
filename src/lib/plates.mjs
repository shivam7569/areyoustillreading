/**
 * plates.mjs — twenty pre-generated "plates" for project artwork, in the site's
 * own vocabulary (plum/bronze accent on paper: rules, combs, ridges, segments).
 * Ported verbatim from the design's editorial/plates.js into an ESM module so it
 * works in BOTH places: the public /projects page inlines a plate's SVG at BUILD
 * time (no client JS), and the Studio editor imports it for the live preview +
 * row thumbnails. Every plate is a pure SVG string using CSS custom properties
 * (var(--accent)/--paper-2/--card), so light/dark are handled by the page theme
 * rather than by two sets of files. Deterministic — no canvas, no randomness.
 *
 *   PLATES              [{id, name, svg}] — the whole set, in assignment order
 *   plate(id)           the plate for an id (falls back to the first)
 *   nextPlate(used)     next id not in `used` (so no two projects share a plate
 *                       until all twenty are spoken for)
 */
const A = 'var(--accent)';
const P = 'var(--paper-2)';
const C = 'var(--card)';

function svg(body) {
  return '<svg viewBox="0 0 300 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' +
    '<rect width="300" height="200" fill="' + P + '"/>' + body + '</svg>';
}
function rules(n, x, y, w, h, gap, o) {
  let s = '';
  for (let i = 0; i < n; i++) s += '<rect x="' + x + '" y="' + (y + i * (h + gap)) + '" width="' + w + '" height="' + h + '" rx="' + (h / 2) + '" fill="' + A + '" opacity="' + o + '"/>';
  return s;
}

export const PLATES = [
  { id: '01', name: 'Comb', svg: svg((() => { let s = ''; const hs = [70, 118, 92, 146, 104, 168, 86, 130, 62, 150, 98, 124]; for (let i = 0; i < hs.length; i++) s += '<rect x="' + (18 + i * 23) + '" y="' + (196 - hs[i]) + '" width="9" height="' + hs[i] + '" rx="4.5" fill="' + A + '" opacity="' + (0.24 + (i % 4) * 0.19) + '"/>'; return s; })()) },
  { id: '02', name: 'The cut', svg: svg(rules(3, 40, 42, 220, 11, 17, 0.85) + '<rect y="112" width="300" height="7" fill="' + A + '"/>' + rules(2, 40, 138, 220, 11, 17, 0.22)) },
  { id: '03', name: 'Segments', svg: svg((() => { let s = ''; for (let i = 0; i < 5; i++) s += '<rect x="' + (24 + i * 52) + '" y="86" width="40" height="28" rx="4" fill="' + A + '" opacity="' + (i < 3 ? 1 : 0.24) + '"/>'; return s; })()) },
  { id: '04', name: 'Ridge', svg: svg('<path d="M0 176 C20 176 30 140 52 140 L78 140 C100 140 110 104 132 104 L158 104 C180 104 190 68 212 68 L238 68 C260 68 270 34 292 34 L300 34" fill="none" stroke="' + A + '" stroke-width="7" stroke-linecap="round"/><path d="M0 176 C20 176 30 140 52 140 L78 140 C100 140 110 104 132 104 L158 104 C180 104 190 68 212 68 L238 68 C260 68 270 34 292 34 L300 34" fill="none" stroke="' + A + '" stroke-width="4" opacity=".3" transform="translate(10,44)"/>') },
  { id: '05', name: 'Silk', svg: svg((() => { let s = ''; for (let i = 0; i < 7; i++) s += '<path d="M-10 ' + (44 + i * 22) + ' C70 ' + (16 + i * 22) + ' 190 ' + (86 + i * 22) + ' 310 ' + (40 + i * 22) + '" fill="none" stroke="' + A + '" stroke-width="3" opacity="' + (0.9 - i * 0.11) + '"/>'; return s; })()) },
  { id: '06', name: 'Field', svg: svg((() => { let s = ''; for (let r = 0; r < 5; r++) for (let c = 0; c < 9; c++) s += '<circle cx="' + (34 + c * 29) + '" cy="' + (38 + r * 32) + '" r="' + (2.4 + ((r + c) % 3) * 2.1) + '" fill="' + A + '" opacity="' + (0.28 + ((r * c) % 4) * 0.18) + '"/>'; return s; })()) },
  { id: '07', name: 'Slant', svg: svg((() => { let s = ''; for (let i = 0; i < 10; i++) s += '<rect x="' + (-40 + i * 36) + '" y="-30" width="12" height="260" rx="6" fill="' + A + '" opacity="' + (0.2 + (i % 5) * 0.16) + '" transform="rotate(18 150 100)"/>'; return s; })()) },
  { id: '08', name: 'Rings', svg: svg((() => { let s = ''; for (let i = 5; i >= 0; i--) s += '<circle cx="150" cy="100" r="' + (18 + i * 22) + '" fill="none" stroke="' + A + '" stroke-width="' + (2 + i * 0.7) + '" opacity="' + (0.9 - i * 0.13) + '"/>'; return s; })() + '<circle cx="150" cy="100" r="9" fill="' + A + '"/>') },
  { id: '09', name: 'Wave', svg: svg((() => { let s = ''; for (let i = 0; i < 6; i++) s += '<path d="M-10 ' + (56 + i * 20) + ' q 40 -34 80 0 t 80 0 t 80 0 t 80 0" fill="none" stroke="' + A + '" stroke-width="4" opacity="' + (0.85 - i * 0.12) + '"/>'; return s; })()) },
  { id: '10', name: 'Stack', svg: svg((() => { let s = ''; const ws = [232, 196, 248, 164, 212, 180]; for (let i = 0; i < ws.length; i++) s += '<rect x="30" y="' + (28 + i * 26) + '" width="' + ws[i] + '" height="14" rx="7" fill="' + A + '" opacity="' + (0.9 - i * 0.13) + '"/>'; return s; })()) },
  { id: '11', name: 'Scatter', svg: svg('<path d="M28 158 C86 148 118 104 168 96 S258 58 286 44" fill="none" stroke="' + A + '" stroke-width="3" stroke-dasharray="7 9" opacity=".55"/>' + '<g fill="' + A + '"><circle cx="28" cy="158" r="8"/><circle cx="84" cy="132" r="5"/><circle cx="122" cy="146" r="10"/><circle cx="168" cy="96" r="6"/><circle cx="214" cy="112" r="9"/><circle cx="252" cy="66" r="5"/><circle cx="286" cy="44" r="8"/></g>') },
  { id: '12', name: 'Split', svg: svg('<rect width="300" height="100" fill="' + A + '" opacity=".9"/><rect y="104" width="300" height="96" fill="' + A + '" opacity=".18"/>' + rules(2, 40, 30, 200, 10, 16, 1).replace(/fill="var\(--accent\)"/g, 'fill="' + C + '"') + rules(2, 40, 132, 200, 10, 16, 0.5)) },
  { id: '13', name: 'Notch', svg: svg('<path d="M0 0h300v200H0Z" fill="' + A + '" opacity=".9"/><path d="M300 0 150 200H300Z" fill="' + P + '"/><rect x="26" y="26" width="120" height="12" rx="6" fill="' + C + '"/><rect x="26" y="52" width="88" height="12" rx="6" fill="' + C + '" opacity=".6"/>') },
  { id: '14', name: 'Halftone', svg: svg((() => { let s = ''; for (let r = 0; r < 6; r++) for (let c = 0; c < 11; c++) { const d = Math.hypot(c - 5, r - 2.5); s += '<circle cx="' + (24 + c * 25.5) + '" cy="' + (28 + r * 29) + '" r="' + Math.max(1, 10 - d * 1.7) + '" fill="' + A + '" opacity="' + Math.max(0.16, 1 - d * 0.16) + '"/>'; } return s; })()) },
  { id: '15', name: 'Arch', svg: svg((() => { let s = ''; for (let i = 5; i >= 0; i--) s += '<path d="M' + (30 + i * 14) + ' 200 A' + (120 - i * 14) + ' ' + (120 - i * 14) + ' 0 0 1 ' + (270 - i * 14) + ' 200" fill="none" stroke="' + A + '" stroke-width="' + (3 + i * 0.8) + '" opacity="' + (0.9 - i * 0.13) + '"/>'; return s; })()) },
  { id: '16', name: 'Ledger', svg: svg(rules(6, 24, 24, 252, 6, 26, 0.22) + (() => { let s = ''; const ws = [96, 148, 62, 190, 118, 74]; for (let i = 0; i < 6; i++) s += '<rect x="24" y="' + (24 + i * 32) + '" width="' + ws[i] + '" height="6" rx="3" fill="' + A + '"/>'; return s; })() + '<rect x="238" y="12" width="4" height="176" fill="' + A + '" opacity=".5"/>') },
  { id: '17', name: 'Chevron', svg: svg((() => { let s = ''; for (let i = 0; i < 6; i++) s += '<path d="M40 ' + (14 + i * 24) + ' L150 ' + (74 + i * 24) + ' L260 ' + (14 + i * 24) + '" fill="none" stroke="' + A + '" stroke-width="6" stroke-linecap="round" opacity="' + (0.88 - i * 0.12) + '"/>'; return s; })()) },
  { id: '18', name: 'Orbit', svg: svg('<circle cx="150" cy="100" r="72" fill="none" stroke="' + A + '" stroke-width="4" opacity=".45"/><circle cx="150" cy="100" r="46" fill="none" stroke="' + A + '" stroke-width="3" opacity=".3"/><circle cx="150" cy="100" r="20" fill="' + A + '"/><circle cx="222" cy="100" r="11" fill="' + A + '"/><circle cx="104" cy="100" r="7" fill="' + A + '" opacity=".6"/>') },
  { id: '19', name: 'Bars', svg: svg((() => { let s = ''; const hs = [58, 96, 74, 132, 108, 154, 88]; for (let i = 0; i < hs.length; i++) s += '<rect x="' + (28 + i * 38) + '" y="' + (170 - hs[i]) + '" width="24" height="' + hs[i] + '" rx="4" fill="' + A + '" opacity="' + (0.3 + i * 0.1) + '"/>'; return s; })() + '<rect x="18" y="172" width="264" height="4" rx="2" fill="' + A + '" opacity=".5"/>') },
  { id: '20', name: 'Weave', svg: svg((() => { let s = ''; for (let i = 0; i < 9; i++) s += '<rect x="' + (16 + i * 33) + '" y="10" width="7" height="180" rx="3.5" fill="' + A + '" opacity="' + (i % 2 ? 0.6 : 0.28) + '"/>'; for (let i = 0; i < 6; i++) s += '<rect x="10" y="' + (18 + i * 31) + '" width="280" height="7" rx="3.5" fill="' + A + '" opacity="' + (i % 2 ? 0.28 : 0.6) + '"/>'; return s; })()) },
];

export function plate(id) {
  return PLATES.find((p) => p.id === id) || PLATES[0];
}
export function nextPlate(used = []) {
  for (const p of PLATES) if (used.indexOf(p.id) === -1) return p.id;
  return PLATES[used.length % PLATES.length].id;
}
