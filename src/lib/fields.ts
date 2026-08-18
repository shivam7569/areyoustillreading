/**
 * src/lib/fields.ts — build-time resolution for the "Field" tier (one level above
 * Series). A field groups related series; it is defined in src/data/fields.json
 * (edited from Studio → Series) and references its series by slug, in reading order.
 * ============================================================================
 * THE RULE: a field exists FOR READERS only once it holds two or more *public*
 * series (a series is public when it has at least one published post). A field of
 * one is invisible on the site — its series looks exactly like a series in no field.
 * Everything here filters to public fields, so callers never have to re-check.
 *
 * USED BY: /fields (index), /fields/[slug] (a field's page), /series (the "part of
 * the X field" line), and BlogPost.astro (the in-post breadcrumb + "next in the
 * field" card). Each series is resolved through the SAME resolveSeries() the /series
 * page uses, so a series looks identical wherever it appears.
 */
import fieldsData from '../data/fields.json';
import seriesDefsData from '../data/series.json';
import { getCollection } from 'astro:content';
import type { CollectionEntry } from 'astro:content';
import { resolveSeries } from './series-plate.mjs';

export type ResolvedSeries = ReturnType<typeof resolveSeries> & { note?: string };

export type PublicField = {
  slug: string;
  title: string;
  summary: string;
  mark: string;                 // field-mark id (see src/lib/field-marks.mjs)
  series: ResolvedSeries[];     // public member series, in the field's declared order
  seriesCount: number;
  partsTotal: number;           // Σ each series' total (published + planned)
  publishedTotal: number;       // Σ published parts
  first?: Date;                 // earliest series start, for "Since …"
};

const seriesDefs = new Map<string, any>(((seriesDefsData as any).series || []).map((d: any) => [d.slug, d]));

// Published posts grouped by their `series` slug (the source of truth for which
// series are public and what parts they hold).
async function loadSeriesGroups(): Promise<Map<string, CollectionEntry<'blog'>[]>> {
  const all = await getCollection('blog', ({ data }) => !data.draft && !!data.series);
  const bySeries = new Map<string, CollectionEntry<'blog'>[]>();
  for (const p of all) {
    const s = p.data.series as string;
    if (!bySeries.has(s)) bySeries.set(s, []);
    bySeries.get(s)!.push(p);
  }
  return bySeries;
}

/** Every PUBLIC field (≥2 public series), each with its series fully resolved. */
export async function getPublicFields(): Promise<PublicField[]> {
  const bySeries = await loadSeriesGroups();
  const out: PublicField[] = [];
  for (const f of ((fieldsData as any).fields || [])) {
    const memberDefs: { slug: string; note?: string }[] = ((f && f.series) || []).map((x: any) =>
      typeof x === 'string' ? { slug: x } : { slug: x && x.slug, note: x && x.note },
    );
    const resolved: ResolvedSeries[] = [];
    const seen = new Set<string>();
    for (const md of memberDefs) {
      const slug = String(md.slug || '').trim();
      if (!slug || seen.has(slug)) continue;
      const members = bySeries.get(slug);
      if (!members || !members.length) continue; // not public yet — no published part
      seen.add(slug);
      const rs = resolveSeries(slug, members, seriesDefs.get(slug)) as ResolvedSeries;
      if (md.note && String(md.note).trim()) rs.note = String(md.note).trim();
      resolved.push(rs);
    }
    if (resolved.length < 2) continue; // ← the rule: a public field needs 2+ public series
    const firsts = resolved.map((s) => s.first).filter(Boolean) as Date[];
    out.push({
      slug: String(f.slug),
      title: String((f.title && String(f.title).trim()) || f.slug),
      summary: String(f.summary || '').trim(),
      mark: String(f.mark || '01'),
      series: resolved,
      seriesCount: resolved.length,
      partsTotal: resolved.reduce((n, s) => n + s.total, 0),
      publishedTotal: resolved.reduce((n, s) => n + s.parts.length, 0),
      first: firsts.length ? new Date(Math.min(...firsts.map((d) => d.getTime()))) : undefined,
    });
  }
  return out;
}

/** slug → { field slug, field title } for every series inside a public field. */
export async function getSeriesFieldMap(): Promise<Map<string, { slug: string; title: string }>> {
  const fields = await getPublicFields();
  const map = new Map<string, { slug: string; title: string }>();
  for (const f of fields) for (const s of f.series) if (!map.has(s.slug)) map.set(s.slug, { slug: f.slug, title: f.title });
  return map;
}

export type FieldNav = {
  field: { slug: string; title: string };
  // The next series in the field (its first part), for the end-of-series card.
  next: { href: string; seriesTitle: string; introTitle: string; introMins: number } | null;
};

/**
 * Field context for a post's in-post nav: the field its series belongs to (for the
 * breadcrumb) and the next series in that field (for the "Next in the field" card
 * shown at the last part). Null when the post's series isn't in a public field.
 */
export async function getFieldNav(post: CollectionEntry<'blog'>): Promise<FieldNav | null> {
  const seriesSlug = post.data.series;
  if (!seriesSlug) return null;
  const fields = await getPublicFields();
  const field = fields.find((f) => f.series.some((s) => s.slug === seriesSlug));
  if (!field) return null;
  const idx = field.series.findIndex((s) => s.slug === seriesSlug);
  const nextSeries = idx >= 0 && idx < field.series.length - 1 ? field.series[idx + 1] : null;
  let next: FieldNav['next'] = null;
  if (nextSeries && nextSeries.parts.length) {
    const intro = nextSeries.parts[0];
    next = { href: `/blog/${intro.id}/`, seriesTitle: nextSeries.title, introTitle: intro.title, introMins: intro.mins };
  }
  return { field: { slug: field.slug, title: field.title }, next };
}
