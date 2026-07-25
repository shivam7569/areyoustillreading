/**
 * src/pages/rss.xml.js — RSS 2.0 feed endpoint for the blog.
 *
 * WHAT THIS FILE IS
 * -----------------
 * An Astro file-based endpoint. Because the filename ends in `.xml.js` (not
 * `.astro`), Astro treats it as a route that emits a raw response rather than an
 * HTML page. At build time the exported `GET()` handler is invoked once and its
 * output is written to `/rss.xml` in the static site. The result is served as a
 * plain static file by Cloudflare Pages — there is NO server/Function on the hot
 * path for the feed (the whole site is a Wrangler direct-upload static bundle).
 *
 * SINGLE RESPONSIBILITY
 * ---------------------
 * Produce the site-wide RSS feed of published blog posts, newest-first. That is
 * the only thing this file does; it holds no auth, payments, or personalization
 * logic.
 *
 * HOW IT FITS THE ARCHITECTURE
 * ----------------------------
 * - Reads from the `blog` content collection (see src/content/config.* for the
 *   Zod schema that defines `title`, `description`, `pubDate`, `draft`, etc.).
 * - Sits alongside the Astro pages that render the same posts as HTML
 *   (src/pages/blog/[...].astro or similar) and the sitemap integration. It is a
 *   sibling output surface, not a dependency of them.
 * - `@astrojs/rss` handles XML escaping and RSS 2.0 envelope formatting so we do
 *   not hand-build XML (avoids injection/malformed-feed bugs).
 *
 * DEPENDS ON
 * ----------
 * - `@astrojs/rss` — feed serializer.
 * - `astro:content` `getCollection` — the typed content layer.
 * - `context.site` — the `site` value configured in astro.config; must be set or
 *   the feed's absolute URLs break. Provided by Astro to the endpoint context.
 *
 * DEPENDED ON BY
 * --------------
 * - Feed readers / aggregators fetching `/rss.xml`.
 * - Typically referenced from a `<link rel="alternate" type="application/rss+xml">`
 *   tag in the site's shared <head> (BaseHead/Layout). If you rename this route,
 *   update that tag too.
 *
 * SECURITY / GOTCHAS
 * ------------------
 * - PUBLIC OUTPUT: this feed is world-readable and cached as a static file. Only
 *   ever include content safe for anonymous consumption here.
 * - PAYWALL SAFETY: the project has a per-post Dodo Payments paywall, but gating
 *   happens at render/runtime. This feed intentionally emits only `title`,
 *   `description`, and a `link` — NOT the post body — so no gated/paywalled prose
 *   can leak through the feed regardless of a post's paywall flags. Do NOT add a
 *   `content:` field here without re-checking entitlement gating, or you risk
 *   leaking paid content to unauthenticated readers.
 * - The `draft` filter below is the only visibility control. Draft posts must
 *   never surface publicly, so keep that predicate.
 */
import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';

/**
 * Static endpoint handler. Astro calls this at build time (SSG); the returned
 * Response is serialized to `/rss.xml`.
 * @param {import('astro').APIContext} context - supplies `context.site` (the
 *   configured canonical origin) used to make item links absolute.
 * @returns {Response} an `application/rss+xml` response body.
 */
export async function GET(context) {
  // Pull only NON-draft posts (the filter predicate excludes `draft: true`), then
  // sort newest-first by publication date. `.valueOf()` yields the epoch ms so the
  // subtraction is a numeric comparator; b - a => descending (most recent first),
  // which is the conventional ordering readers expect at the top of a feed.
  const posts = (await getCollection('blog', ({ data }) => !data.draft)).sort(
    (a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf()
  );

  // Hand the mapped items to @astrojs/rss, which builds the RSS 2.0 XML envelope
  // and escapes every field. We deliberately expose only metadata + a link.
  return rss({
    title: 'areyoustillreading',
    description: 'Notes on LLM engineering, plus the projects behind them.',
    // `context.site` makes each `link` absolute in the emitted feed. If `site` is
    // unset in astro.config, links become relative/broken for external readers.
    site: context.site,
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.pubDate,
      // Link to the canonical post page, NOT the post body. Trailing slash matches
      // Astro's default page URL shape so readers land on the real, gate-aware page
      // where any paywall enforcement actually runs. `post.id` is the collection
      // slug (e.g. folder/filename without extension).
      link: `/blog/${post.id}/`,
    })),
  });
}
