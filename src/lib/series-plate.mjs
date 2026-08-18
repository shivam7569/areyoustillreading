/*
 * =============================================================================
 * src/lib/series-plate.mjs — the shared "silk plate" generator + series resolver
 * =============================================================================
 * Extracted verbatim from series.astro so the public /series page, each field's
 * page (/fields/<slug>) and the <SeriesPlate> component all draw byte-identical
 * plates and derive series display data the same way. Pure, build-time only —
 * no I/O, no astro:content types (callers pass already-loaded collection entries).
 *
 * A plate is a field of faint accent comb-curves (~3 per part) that pinch to a
 * waist, with a bold SPINE threading the published parts (each at a height set by
 * its reading time) and hollow "to-come" nodes for declared-but-unpublished parts.
 */

/** @typedef {[number, number]} Pt */

// Catmull-Rom → cubic bezier: a smooth curve through the given points.
export function smooth(/** @type {Pt[]} */ pts) {
  if (pts.length < 2) return '';
  const d = [`M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d.push(`C ${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`);
  }
  return d.join(' ');
}

// The comb: `lines` faint curves that pinch to a waist (top curves bow down, bottom
// bow up), fading in weight + opacity toward the bottom. ≈3 lines per part.
export function combLines(parts) {
  const lines = Math.max(9, Math.min(3 * parts, 18));
  const out = [];
  for (let i = 0; i < lines; i++) {
    const t = i / (lines - 1);                 // 0 top … 1 bottom
    const baseY = 26 + t * 168;                // spread down the field
    const amp = (0.5 - t) * 42;                // + at top (bows down), − at bottom (bows up) → waist
    const pts = [];
    for (let x = -10; x <= 310; x += 40) {
      const hx = (x + 10) / 320;               // 0…1 across
      const bow = Math.sin(hx * Math.PI);      // 0…1…0, peak at the waist
      const drift = (hx - 0.5) * 10 * (0.5 - t); // gentle wind so lines aren't mirror-symmetric
      pts.push([x, baseY + amp * bow + drift]);
    }
    out.push({ d: smooth(pts), w: +(1.7 - t * 0.7).toFixed(2), o: +(0.4 - t * 0.22).toFixed(2) });
  }
  return out;
}

// The spine: a node per published part (solid, y set by reading time), plus a node
// per PLANNED-but-unpublished part (hollow ring) when a series declares a total. A
// bold curve threads the published parts; a dashed tail runs on to the unwritten ones.
export function spine(mins, total) {
  const pub = mins.length;
  if (!pub) return { path: '', tail: '', solidNodes: [], futureNodes: [] };
  const shown = Math.max(pub, Math.min(total || pub, 6)); // cap the plate at 6 nodes
  const xs = shown === 1 ? [150] : Array.from({ length: shown }, (_, i) => 30 + (i * 240) / (shown - 1));
  const lo = Math.min(...mins), hi = Math.max(...mins);
  const ys = [];
  for (let i = 0; i < shown; i++) {
    if (i < pub) ys.push(hi === lo ? 105 : 140 - ((mins[i] - lo) / (hi - lo)) * 74); // published: read-time height
    else ys.push(ys.length ? ys[ys.length - 1] : 105);                               // future: flat at last height
  }
  const nodes = xs.map((x, i) => [x, ys[i]]);
  return {
    path: smooth(nodes.slice(0, pub)),                                   // solid spine through published
    tail: pub < shown ? smooth(nodes.slice(Math.max(0, pub - 1))) : '',  // dashed tail into the unwritten parts
    solidNodes: nodes.slice(0, pub),
    futureNodes: nodes.slice(pub),
  };
}

// Per-series accent wash position (deterministic from the slug, so a plate always
// glows from the same corner across builds).
export const WASH = [
  { x: '16%', y: '10%', o: '13%' }, { x: '82%', y: '16%', o: '11%' },
  { x: '28%', y: '86%', o: '10%' }, { x: '70%', y: '78%', o: '12%' },
  { x: '20%', y: '50%', o: '11%' }, { x: '86%', y: '52%', o: '10%' },
];
export function washFor(slug) {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  return WASH[h % WASH.length];
}

const readMins = (body) => Math.max(1, Math.round(((body || '').split(/\s+/).filter(Boolean).length) / 200));
const prettify = (slug) => { const w = slug.replace(/[-_]+/g, ' ').trim(); return w.charAt(0).toUpperCase() + w.slice(1); };
const firstOf = (members, key) => {
  for (const p of members) { const v = p.data[key]; if (v != null && v !== '' && !(Array.isArray(v) && v.length === 0)) return v; }
  return undefined;
};

// bySeriesOrder, inlined (kept dependency-free): seriesOrder asc, unordered to the
// back, ties by publish date (oldest first). Mirrors src/lib/series.ts exactly.
function orderCmp(a, b) {
  const oa = a.data.seriesOrder, ob = b.data.seriesOrder;
  const hasA = typeof oa === 'number', hasB = typeof ob === 'number';
  if (hasA && hasB && oa !== ob) return oa - ob;
  if (hasA !== hasB) return hasA ? -1 : 1;
  return a.data.pubDate.getTime() - b.data.pubDate.getTime();
}

/**
 * Resolve a series' full display model from its published members + optional
 * series.json definition. The def, when present, is the SOLE source of the knobs
 * (its empty values mean "cleared") — only post-only series read frontmatter. This
 * is the single source of truth used by /series, /fields/<slug> and <SeriesPlate>.
 */
export function resolveSeries(slug, membersInput, def) {
  const members = [...membersInput].sort(orderCmp);
  const hasDef = !!def;
  const title = (def && def.title && String(def.title).trim()) || firstOf(members, 'seriesTitle') || prettify(slug);
  const parts = members.map((p) => ({ id: p.id, title: p.data.title, date: p.data.pubDate, mins: readMins(p.body) }));
  const planned = ((hasDef ? (def.planned || []) : firstOf(members, 'seriesPlanned')) || []).filter((t) => t && t.trim());
  const declaredTotal = hasDef ? (typeof def.total === 'number' ? def.total : undefined) : firstOf(members, 'seriesTotal');
  const total = Math.max(parts.length, declaredTotal || parts.length, parts.length + planned.length);
  const allDeclaredPublished = !!declaredTotal && parts.length >= declaredTotal && planned.length === 0;
  const status = (hasDef ? (def.status || '') : firstOf(members, 'seriesStatus')) || (allDeclaredPublished ? 'complete' : 'in-progress');
  return {
    slug, title, parts, planned, total, status,
    description: members[0] && members[0].data.description,
    first: parts[0] && parts[0].date,
    latest: parts.length ? parts[parts.length - 1].date : undefined,
    comb: combLines(total),
    spine: spine(parts.map((p) => p.mins), total),
    wash: washFor(slug),
  };
}
