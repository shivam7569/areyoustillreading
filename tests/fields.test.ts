/**
 * tests/fields.test.ts
 * ==================================================================
 * Two kinds of check, both content-independent so they hold whether or
 * not any field is currently defined (the demo field can be reset away):
 *   1. UNIT — the generative field-mark library draws valid inline SVG
 *      from a field's data and offers the full set of ten marks.
 *   2. BUILD OUTPUT — the /fields route is emitted and the "Field" entry
 *      (with its descriptor line) is wired into the Blog dropdown.
 * The build-output half reads dist/, so it is meaningful only after
 * `astro build` has run.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { FIELD_MARKS, markSvg, fieldMark } from '../src/lib/field-marks.mjs';

const dist = join(process.cwd(), 'dist');
const read = (p: string) => readFileSync(join(dist, p), 'utf-8');
const exists = (p: string) => existsSync(join(dist, p));

describe('field marks (generative)', () => {
  it('offers exactly ten marks', () => {
    expect(FIELD_MARKS.length).toBe(10);
    expect(FIELD_MARKS.map((m) => m.id)).toEqual(['01', '02', '03', '04', '05', '06', '07', '08', '09', '10']);
  });

  it('draws an inline SVG from a field’s series data', () => {
    const svg = markSvg('01', [{ n: 5, pub: 3 }, { n: 4, pub: 2 }]);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('<path');
    expect(svg).toContain('var(--accent)'); // theme-aware, no hard-coded colour
  });

  it('varies by mark id and falls back for an unknown id', () => {
    const a = markSvg('01', [{ n: 3, pub: 1 }, { n: 3, pub: 3 }]);
    const b = markSvg('10', [{ n: 3, pub: 1 }, { n: 3, pub: 3 }]);
    expect(a).not.toBe(b);
    expect(fieldMark('nope').id).toBe('01');
  });

  // Regression guard for the fit-to-count fix: every mark must keep all of its
  // part-nodes (and bars/bands) inside the 360×220 viewBox for any series count,
  // so a field of 4+ series never silently loses a series off the canvas.
  it.each([2, 3, 4, 5, 6])('keeps every node inside the frame for %i series (all marks)', (n) => {
    const S = Array.from({ length: n }, (_, i) => ({ n: 3 + (i % 3), pub: 1 + (i % 2) }));
    for (const m of FIELD_MARKS) {
      const svg = markSvg(m.id, S);
      for (const c of svg.matchAll(/<circle cx="(-?[\d.]+)" cy="(-?[\d.]+)"/g)) {
        const x = parseFloat(c[1]), y = parseFloat(c[2]);
        expect(x >= -1 && x <= 361, `${m.name} n=${n}: circle x=${x} off-canvas`).toBe(true);
        expect(y >= -1 && y <= 221, `${m.name} n=${n}: circle y=${y} off-canvas`).toBe(true);
      }
      for (const r of svg.matchAll(/<rect x="(-?[\d.]+)" y="(-?[\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)) {
        const x = parseFloat(r[1]), y = parseFloat(r[2]), w = parseFloat(r[3]), h = parseFloat(r[4]);
        expect(x >= -1 && x + w <= 361, `${m.name} n=${n}: rect x span off-canvas`).toBe(true);
        expect(y >= -1 && y + h <= 221, `${m.name} n=${n}: rect y span off-canvas`).toBe(true);
      }
    }
  });
});

describe('fields feature (built output)', () => {
  it('emits the /fields index route', () => {
    expect(exists('fields/index.html')).toBe(true);
  });

  it('adds Field to the Blog dropdown with its descriptor line', () => {
    const html = read('fields/index.html');
    expect(html).toMatch(/href="\/fields\/?"/); // the dropdown + footer link
    expect(html).toContain('Series that belong together'); // the Field descriptor
  });
});
