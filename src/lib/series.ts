/**
 * src/lib/series.ts — build-time helper that assembles a post's "series" context.
 * ============================================================================
 * A series is just the set of published posts sharing a `series` slug (see the
 * frontmatter contract in src/content.config.ts). This module gathers that set,
 * orders it, and returns everything the in-post navigation needs: the ordered
 * parts list, where the current post sits, and the previous/next parts.
 *
 * WHY BUILD-TIME: getCollection() is the source of truth and only exists during
 * `astro build`, so the series list is always correct and needs no manual upkeep
 * — adding a new part re-runs this for every page on the next build, keeping each
 * post's list (and the author-written intro's list) in sync automatically.
 *
 * USED BY: src/layouts/BlogPost.astro (which renders <SeriesNav/> from the result).
 * Returns null for any post not in a series (or a "series" of one), so callers can
 * simply do `{series && <SeriesNav .../>}`.
 */
import { getCollection } from 'astro:content';
import type { CollectionEntry } from 'astro:content';
import seriesDefsData from '../data/series.json';

// Studio-defined knobs (total / status / planned), keyed by slug — authoritative
// over frontmatter for the DECLARED total the in-post spine draws its ticks from.
const seriesDefsMap = new Map<string, any>(((seriesDefsData as any).series || []).map((d: any) => [d.slug, d]));
const firstDefined = (members: CollectionEntry<'blog'>[], key: string): any => {
  for (const p of members) { const v = (p.data as any)[key]; if (v != null && v !== '' && !(Array.isArray(v) && v.length === 0)) return v; }
  return undefined;
};

export type SeriesPart = {
  slug: string; // the part's URL slug (post id)
  title: string; // the part's own post title
  order: number; // 1-based position in the series
  current: boolean; // is this the post being rendered?
};

export type SeriesNavData = {
  slug: string; // the series slug
  title: string; // human display name for the series
  parts: SeriesPart[]; // every published part, ordered
  index: number; // 1-based position of the current post
  total: number; // DECLARED total parts (published + planned) — the spine's length
  planned: string[]; // planned/to-come part titles (the spine's hollow ticks)
  introSlug: string; // slug of the first part (the author-written index/intro)
  isIntro: boolean; // is the current post the intro/first part?
  prev: { slug: string; title: string } | null;
  next: { slug: string; title: string } | null;
};

// Prettify a slug for display when no explicit seriesTitle is provided
// (e.g. "rust-web-server" -> "Rust web server"). First word capitalized only,
// so multi-word series read as a sentence rather than Title Case shouting.
function prettify(slug: string): string {
  const words = slug.replace(/[-_]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// Shared reading order for a series' members: by seriesOrder ascending; posts
// without an explicit order fall to the back; ties break by publish date (oldest
// first). Used by every series consumer so the numbering is identical everywhere.
export function bySeriesOrder(
  a: CollectionEntry<'blog'>,
  b: CollectionEntry<'blog'>,
): number {
  const oa = a.data.seriesOrder;
  const ob = b.data.seriesOrder;
  const hasA = typeof oa === 'number';
  const hasB = typeof ob === 'number';
  if (hasA && hasB && oa !== ob) return (oa as number) - (ob as number);
  if (hasA !== hasB) return hasA ? -1 : 1;
  return a.data.pubDate.getTime() - b.data.pubDate.getTime();
}

// Pick a series' display title: the first non-empty seriesTitle among its
// members, else the prettified slug.
function seriesTitleOf(slug: string, members: CollectionEntry<'blog'>[]): string {
  return (
    members.map((p) => p.data.seriesTitle).find((t) => t && t.trim())?.trim() ||
    prettify(slug)
  );
}

export type SeriesLabel = {
  slug: string; // series slug
  title: string; // display name
  part: number; // 1-based position of this post
  total: number; // parts in the series
  introSlug: string; // first part (the author-written index)
  isIntro: boolean; // is this post the first part?
};

/**
 * Build a lookup of postId -> SeriesLabel for EVERY published post that belongs
 * to a multi-post series. Computed once from the whole collection, so a listing
 * (public /blog or the Studio) can annotate each row with its series + part in a
 * single call. Posts not in a (multi-post) series are simply absent from the map.
 */
export async function getSeriesLookup(): Promise<Record<string, SeriesLabel>> {
  const all = await getCollection(
    'blog',
    ({ data }) => !data.draft && !!data.series,
  );
  const bySeries = new Map<string, CollectionEntry<'blog'>[]>();
  for (const p of all) {
    const s = p.data.series as string;
    (bySeries.get(s) ?? bySeries.set(s, []).get(s)!).push(p);
  }
  const out: Record<string, SeriesLabel> = {};
  for (const [slug, members] of bySeries) {
    if (members.length < 2) continue; // a series of one isn't navigable
    members.sort(bySeriesOrder);
    const title = seriesTitleOf(slug, members);
    const introSlug = members[0].id;
    members.forEach((m, i) => {
      out[m.id] = { slug, title, part: i + 1, total: members.length, introSlug, isIntro: i === 0 };
    });
  }
  return out;
}

/**
 * Build the series navigation context for `post`, or null if it isn't part of a
 * (multi-post) series. Drafts are excluded from the parts list — matching the
 * public listing — so an unpublished part never shows up until it goes live.
 */
export async function getSeriesNav(
  post: CollectionEntry<'blog'>,
): Promise<SeriesNavData | null> {
  const seriesSlug = post.data.series;
  if (!seriesSlug) return null;

  // Every published post in the same series (the current post included).
  const members = await getCollection(
    'blog',
    ({ data }) => !data.draft && data.series === seriesSlug,
  );
  // A lone post isn't a series worth navigating — treat it as standalone until a
  // second part is published.
  if (members.length < 2) return null;

  // Order by seriesOrder ascending (shared comparator), for a stable reading order.
  members.sort(bySeriesOrder);

  const parts: SeriesPart[] = members.map((p, i) => ({
    slug: p.id,
    title: p.data.title,
    order: i + 1,
    current: p.id === post.id,
  }));

  const idx = parts.findIndex((p) => p.current);
  const title = seriesTitleOf(seriesSlug, members);

  // Declared total (published + planned), so the spine shows hollow "to-come" ticks
  // beyond the published parts. The series.json definition wins over frontmatter.
  const def = seriesDefsMap.get(seriesSlug);
  const hasDef = !!def;
  const planned: string[] = ((hasDef ? (def.planned || []) : firstDefined(members, 'seriesPlanned')) || [])
    .map((t: any) => String(t || '').trim())
    .filter(Boolean);
  const declaredTotal = hasDef ? (typeof def.total === 'number' ? def.total : undefined) : firstDefined(members, 'seriesTotal');
  const total = Math.max(parts.length, Number(declaredTotal) || parts.length, parts.length + planned.length);

  return {
    slug: seriesSlug,
    title,
    parts,
    index: idx + 1,
    total,
    planned,
    introSlug: parts[0].slug,
    isIntro: idx === 0,
    prev: idx > 0 ? { slug: parts[idx - 1].slug, title: parts[idx - 1].title } : null,
    next: idx < parts.length - 1 ? { slug: parts[idx + 1].slug, title: parts[idx + 1].title } : null,
  };
}
