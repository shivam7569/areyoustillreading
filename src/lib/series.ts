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
  total: number; // number of parts
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

  // Order by seriesOrder ascending; posts without an explicit order fall to the
  // back, then break ties by publish date (oldest first) for a stable reading order.
  members.sort((a, b) => {
    const oa = a.data.seriesOrder;
    const ob = b.data.seriesOrder;
    const hasA = typeof oa === 'number';
    const hasB = typeof ob === 'number';
    if (hasA && hasB && oa !== ob) return (oa as number) - (ob as number);
    if (hasA !== hasB) return hasA ? -1 : 1; // ordered ones first
    return a.data.pubDate.getTime() - b.data.pubDate.getTime();
  });

  const parts: SeriesPart[] = members.map((p, i) => ({
    slug: p.id,
    title: p.data.title,
    order: i + 1,
    current: p.id === post.id,
  }));

  const idx = parts.findIndex((p) => p.current);
  // Display title: first non-empty seriesTitle across the series, else prettified slug.
  const title =
    members.map((p) => p.data.seriesTitle).find((t) => t && t.trim())?.trim() ||
    prettify(seriesSlug);

  return {
    slug: seriesSlug,
    title,
    parts,
    index: idx + 1,
    total: parts.length,
    introSlug: parts[0].slug,
    isIntro: idx === 0,
    prev: idx > 0 ? { slug: parts[idx - 1].slug, title: parts[idx - 1].title } : null,
    next: idx < parts.length - 1 ? { slug: parts[idx + 1].slug, title: parts[idx + 1].title } : null,
  };
}
