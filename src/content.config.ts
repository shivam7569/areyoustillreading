/**
 * =============================================================================
 * src/content.config.ts — Astro Content Collections definition (single source
 * of truth for the shape of every blog post's frontmatter).
 * =============================================================================
 *
 * WHAT THIS FILE IS
 * -----------------
 * Astro's "content layer" config. At build time Astro loads this module, uses
 * the `glob` loader to discover Markdown files, and validates each file's YAML
 * frontmatter against the Zod `schema` below. The validated, typed data is then
 * queryable everywhere via `getCollection('blog')` / `getEntry('blog', …)` and
 * is fully type-safe (the Zod schema is the type source). A file that fails
 * validation FAILS THE BUILD — this is the fail-safe that stops a malformed or
 * mislabeled post from ever shipping.
 *
 * SINGLE RESPONSIBILITY
 * ---------------------
 * Declare collections and their frontmatter contracts. Nothing else. It does no
 * rendering, routing, auth, or data fetching — it only guarantees that any post
 * consumed downstream has exactly these fields with exactly these types.
 *
 * WHERE IT FITS IN THE ARCHITECTURE
 * ---------------------------------
 *   - Markdown lives in ./src/content/blog/**\/*.md (see loader `base` below).
 *   - Pages/components call getCollection('blog') to list, filter (e.g. drop
 *     `draft`), sort by `pubDate`, and render bodies through the Markdown
 *     pipeline (Shiki, KaTeX, build-time D2 diagrams, etc.).
 *   - RSS (@astrojs/rss), the sitemap, Pagefind search indexing, and
 *     astro-og-canvas OG-image generation all read from this same collection,
 *     so every field here is a contract those consumers rely on.
 *
 * DEPENDS ON
 * ----------
 *   - `astro:content` — defineCollection + Zod (`z`) re-export.
 *   - `astro/loaders` — the `glob` content loader.
 *
 * DEPENDED ON BY
 * --------------
 *   - Every `.astro` page/component that queries the `blog` collection — as of
 *     this writing: src/pages/blog/index.astro (listing), blog/[...slug].astro
 *     (public post render), blog/tags/* (tag pages), src/pages/index.astro
 *     (home), src/pages/rss.xml.js (feed), src/pages/og/[...route].ts (OG
 *     images), and src/layouts/BlogPost.astro.
 *   - The Phase 3 paywall/gating layer, whose concrete entry point is
 *     src/pages/gated/[...slug].astro (Pages Functions + Supabase RLS): that
 *     route is what actually keys off the `gateable` / `preview` fields declared
 *     here to decide what to ship statically vs. release only to entitled users.
 *
 * SECURITY / GATING ASSUMPTION (READ BEFORE EDITING)
 * --------------------------------------------------
 * This schema is a BUILD-TIME data contract, NOT a security boundary. Marking a
 * post `gateable: true` only signals *intent* to monetize; it does not by itself
 * keep the body secret. The actual secrecy guarantee lives elsewhere: the build
 * must exclude a gateable post's full body from the static HTML, and the runtime
 * gate (Pages Function checking a Supabase entitlement under Row-Level Security)
 * is what authorizes release of that body. If a build step ever fails to honor
 * `gateable`, the paywalled content leaks into static output regardless of what
 * this file says. Treat the enforcement of these flags as belonging to the
 * build/render/entitlement code (src/pages/gated/[...slug].astro plus the
 * Pages Functions it calls) — this file only names the flags.
 */
import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// The one and only content collection: `blog`. `defineCollection` binds a
// content loader (how files are found) to a Zod schema (how each file's
// frontmatter is validated + typed).
const blog = defineCollection({
  // Discover every Markdown file under src/content/blog (recursively, via `**`).
  // `base` is resolved relative to the project root. Note: only `.md` is
  // globbed here — `.mdx` would NOT be picked up unless this pattern changes.
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    // Human-readable post title. Required — used in <title>, headings, RSS
    // <title>, sitemap, and OG-image text. No default: a title-less post is a
    // mistake we want the build to reject.
    title: z.string(),
    // Short summary. Required — feeds <meta name="description">, RSS item
    // description, and OG cards. Distinct from `preview` (see below): this is
    // SEO/metadata copy, not the paywall teaser.
    description: z.string(),
    // Publication date. `z.coerce.date()` accepts a YAML string like
    // "2026-07-25" (or a Date) and coerces to a JS Date, so authors can write
    // plain date strings in frontmatter. Drives sort order and RSS <pubDate>.
    pubDate: z.coerce.date(),
    // Optional "last updated" date, same coercion. `.optional()` => omit it for
    // posts never edited after publishing; only set when a real update happens.
    updatedDate: z.coerce.date().optional(),
    // Free-form tag list. Defaults to [] so downstream code can always iterate
    // without a null/undefined guard (fail-safe against missing frontmatter).
    tags: z.array(z.string()).default([]),
    // Byline author (optional). Set at publish time to the publisher's pen name
    // (their account display name); legacy posts without it fall back to the site
    // author in BlogPost.astro. Display-only — never a security/identity boundary.
    author: z.string().optional(),
    // --- Series (optional) --------------------------------------------------
    // A post belongs to a series when `series` is set to a shared slug. All posts
    // with the same `series` are grouped and ordered by `seriesOrder` (ascending;
    // the lowest is the intro/index the author writes). `seriesTitle` is the human
    // display name — set on the intro (or any part); the first non-empty one wins.
    // These only drive the in-post series navigation (src/lib/series.ts +
    // SeriesNav.astro); a post without them behaves exactly as before.
    series: z.string().optional(),
    seriesOrder: z.coerce.number().optional(),
    seriesTitle: z.string().optional(),
    // Richer series metadata for the /series plate (all optional; set on ANY part —
    // the series page reads the first non-empty across the group). `seriesTotal` is the
    // planned number of parts (enables "3 of 5" + the empty progress segments + hollow
    // "to-come" nodes on the plate). `seriesStatus` labels the collection. `seriesPlanned`
    // lists upcoming part titles not yet published (shown as muted "soon" rows).
    seriesTotal: z.coerce.number().optional(),
    seriesStatus: z.enum(['in-progress', 'complete', 'paused']).optional(),
    seriesPlanned: z.array(z.string()).default([]),
    // Draft flag. Defaults to false (published). Pages are expected to filter
    // out `draft: true` entries in production builds so unfinished posts stay
    // hidden. This is an editorial gate, NOT a security gate — a draft still
    // exists in the source tree; it's simply not listed/rendered when filtered.
    draft: z.boolean().default(false),
    // Scheduled publishing (optional). A SCHEDULED post is `draft: true` (so it stays
    // hidden and out of the build) PLUS `publishAt` set to a future ISO datetime. A
    // cron job (.github/workflows/scheduled-publish.yml) flips it to `draft: false` and
    // drops `publishAt` once that time passes, committing → a rebuild makes it live.
    // Display-only in the schema; the scheduler is what enforces the timing.
    publishAt: z.coerce.date().optional(),
    // Phase 3 (paywall): a "gateable" post is monetizable — its full body is
    // meant to be kept OUT of the static HTML and served only via the runtime
    // entitlement-checking gate (Pages Function → Supabase RLS → Dodo Payments
    // Merchant-of-Record). Defaults to false so posts are fully static/public
    // unless explicitly opted in — the safe default is "not paywalled", so a
    // forgotten flag never accidentally hides content behind a paywall.
    //
    // SECURITY NOTE: setting this to true does not, on its own, protect the
    // body — see the file header. It is a declaration of intent that the build
    // and runtime gate must honor. If they don't, the content leaks.
    gateable: z.boolean().default(false),
    // The public teaser shown before a gateable post is unlocked. Optional
    // because non-gateable posts don't need one. WHY it's the author's job to
    // write this: only the `preview` text is safe to ship in static HTML for a
    // gateable post; the full body must not be. Treat everything NOT in
    // `preview` as the protected, entitlement-only portion.
    preview: z.string().optional(),
  }),
});

// Astro requires the config to export a `collections` map keyed by collection
// name; these keys are the exact strings passed to getCollection('blog'), etc.
export const collections = { blog };
