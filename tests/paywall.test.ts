/**
 * =============================================================================
 * tests/paywall.test.ts — Paywall leak-protection regression suite
 * =============================================================================
 *
 * WHAT THIS FILE IS
 * -----------------
 * A Vitest suite guarding the single most important security invariant of the
 * per-post paywall: **the gated (paid) body of a premium post must never be
 * shipped to any public, unauthenticated surface of the static build.** It is the
 * last line of defense against the classic static-site paywall failure mode where
 * the "protected" content is actually present in the HTML/feed and merely hidden
 * with CSS or a JS overlay — trivially scraped by viewing source.
 *
 * FIXTURE-AGNOSTIC BY DESIGN
 * --------------------------
 * This suite does NOT hardcode a demo post. It DISCOVERS every gateable post from
 * source (`src/content/blog/*.md` with `gateable: true`), derives a distinctive
 * "paid canary" from each one's body, and asserts that canary appears ONLY in the
 * gated route — never in the public post page, the listing, or the RSS feed. So it
 * protects whatever real gated posts exist and needs no throwaway demo content. If
 * there are no gated posts yet, the body checks simply have nothing to run against
 * (there is nothing to leak); the sitemap-discovery check still runs unconditionally.
 *
 * HOW IT FITS THE ARCHITECTURE
 * ----------------------------
 * The paywall splits every premium post into two rendered artifacts:
 *   - PUBLIC page (`/blog/<slug>/`) — teaser/preview + <PaywallGate> only; the paid
 *     body is deliberately omitted from this HTML.
 *   - GATED route (`/gated/<slug>/`) — the FULL body, runtime-gated by a Cloudflare
 *     Pages Function (token/entitlement middleware + Supabase RLS + Dodo). It must be
 *     no-indexed (data-pagefind-ignore) and kept out of every crawlable index.
 * This suite verifies the BUILD-TIME containment half — which the runtime gate can't
 * retroactively fix once bytes have leaked into a feed or the search index.
 *
 * DEPENDS ON: a completed production build in `dist/` (run `npm run build` first) and
 * the blog source under `src/content/blog`.
 *
 * NOTE ON MATCHING: comparisons normalize both sides to a lowercase alphanumeric
 * stream (tags, HTML entities, whitespace, and Markdown syntax stripped), so a canary
 * is caught even if it leaked inside a JSON island prop or an attribute — a leak is a
 * leak — while rendering/encoding differences don't cause false positives.
 * =============================================================================
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dist = join(process.cwd(), 'dist');
const blogSrc = join(process.cwd(), 'src', 'content', 'blog');
const read = (p: string) => readFileSync(join(dist, p), 'utf-8');
// Collapse to a lowercase alphanumeric stream so matching ignores tags/entities/
// whitespace/Markdown — a robust way to detect the same prose across HTML and source.
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

interface Gated { slug: string; canary: string }

// Discover every gateable post from source and pick a distinctive paid canary: the
// longest plain-prose line in its body (deep body lines are past the short preview
// teaser, so they are paid-only). Posts with no substantial line are skipped — there
// is nothing distinctive enough to assert on.
function gatedPosts(): Gated[] {
  if (!existsSync(blogSrc)) return [];
  const out: Gated[] = [];
  for (const f of readdirSync(blogSrc).filter((n) => n.endsWith('.md'))) {
    const raw = readFileSync(join(blogSrc, f), 'utf-8');
    const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
    if (!m) continue;
    const [, frontmatter, body] = m;
    if (!/^gateable:\s*true\s*$/m.test(frontmatter)) continue;
    const canary = body
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => norm(l).length >= 24) // long enough to be unique
      .sort((a, b) => norm(b).length - norm(a).length)[0];
    if (canary) out.push({ slug: f.replace(/\.md$/, ''), canary });
  }
  return out;
}

describe('paywall content protection', () => {
  const posts = gatedPosts();

  // Unconditional: the sitemap must never advertise the gated route's existence to
  // crawlers, regardless of whether any gated posts currently exist.
  it('never advertises the /gated/ route in the sitemap', () => {
    if (existsSync(join(dist, 'sitemap-0.xml'))) {
      expect(read('sitemap-0.xml')).not.toContain('/gated/');
    }
  });

  // Runs once per gateable post; if there are none, there is nothing to leak.
  it.runIf(posts.length > 0)('keeps every gated post’s paid body out of all public surfaces', () => {
    const listing = norm(read('blog/index.html'));
    const rss = existsSync(join(dist, 'rss.xml')) ? norm(read('rss.xml')) : '';
    for (const { slug, canary } of posts) {
      const nCanary = norm(canary);
      // The full paid body IS allowed to exist — but ONLY at the no-indexed gated route.
      const gated = read(`gated/${slug}/index.html`);
      expect(norm(gated), `paid body missing from /gated/${slug}`).toContain(nCanary);
      expect(gated, `/gated/${slug} must be no-indexed`).toContain('data-pagefind-ignore');
      // And it must appear on NO public surface: the post page, the listing, or the feed.
      expect(norm(read(`blog/${slug}/index.html`)), `paid body leaked into /blog/${slug}`).not.toContain(nCanary);
      expect(listing, `paid body leaked into the blog listing`).not.toContain(nCanary);
      if (rss) expect(rss, `paid body leaked into RSS`).not.toContain(nCanary);
    }
  });
});
