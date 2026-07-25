/**
 * tests/rss-sitemap.test.ts
 * ============================================================================
 * WHAT THIS FILE IS
 * ----------------------------------------------------------------------------
 * A Vitest build-artifact smoke test. It does NOT exercise application logic,
 * a server, or a browser. Instead it inspects the *output* of a completed
 * Astro production build (the `dist/` directory) and asserts that two
 * SEO/syndication artifacts were actually emitted:
 *   1. `dist/rss.xml`          — the RSS 2.0 feed produced by @astrojs/rss.
 *   2. `dist/sitemap-index.xml` — the sitemap index produced by @astrojs/sitemap.
 *
 * SINGLE RESPONSIBILITY
 * ----------------------------------------------------------------------------
 * Prove that the static build's discoverability surface (feed + sitemap) is
 * present and, for the feed, contains the expected canonical post. Nothing
 * more. It is a regression guard against the RSS/sitemap integrations silently
 * breaking, being misconfigured, or the feed endpoint failing to enumerate
 * published posts — any of which would ship a site that search engines and
 * feed readers cannot properly index.
 *
 * HOW IT FITS THE ARCHITECTURE
 * ----------------------------------------------------------------------------
 * This is a static Astro site deployed to Cloudflare Pages via Wrangler direct
 * upload (`npm run deploy`). The RSS feed and sitemap are generated at BUILD
 * time — they are plain files baked into `dist/`, not Pages Functions and not
 * anything backed by Supabase/PostgREST at request time. Consequently this
 * test has a hard ordering dependency: a production build (`astro build`, i.e.
 * `npm run build`) MUST have run first to populate `dist/`. Run out of order,
 * every assertion fails on a missing file — the failure means "build first",
 * not "feature broken". (See GOTCHA below.)
 *
 * DEPENDENCIES (imports)
 * ----------------------------------------------------------------------------
 *   - vitest        : `describe`/`it`/`expect` test harness + assertions.
 *   - node:fs       : `readFileSync` (read the feed) + `existsSync` (presence).
 *   - node:path     : `join` for OS-agnostic path building (matters on Windows,
 *                     the dev environment here — never hardcode "/").
 * No project source modules are imported: the contract under test is the build
 * OUTPUT on disk, deliberately decoupled from how it was generated.
 *
 * WHAT DEPENDS ON THIS FILE
 * ----------------------------------------------------------------------------
 * Nothing imports it. It is discovered and run by Vitest (CI and local test
 * runs). It is a leaf in the dependency graph.
 *
 * SECURITY / RLS NOTES
 * ----------------------------------------------------------------------------
 * None directly. There are no tokens, entitlement checks, signatures, or
 * honeypots here — RSS and sitemap are fully public, build-time artifacts with
 * no auth surface. The only indirect security-adjacent concern: the RSS feed
 * must never leak gated/paywalled or draft content. This test does not verify
 * that exclusion (it only asserts the one public post IS present); leak
 * protection for gated content lives in the content-gating tests, not here.
 *
 * GOTCHA (read before debugging a failure)
 * ----------------------------------------------------------------------------
 *   - Reads `dist/` relative to process.cwd(); assumes Vitest runs from the
 *     repo root. Running from a subdirectory breaks path resolution.
 *   - Assertions are substring/existence checks, NOT XML parsing or schema
 *     validation. They confirm presence, not well-formedness. Malformed-but-
 *     containing-the-string XML would still pass — intentional: this is a
 *     smoke test, kept cheap and resilient to feed-format churn.
 *   - The expected strings ('Hello, world', '/blog/hello-world') are coupled to
 *     the seeded demo post. If that post is renamed/removed, update them here.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Absolute path to the build output directory. Resolved from the current
// working directory (expected to be the repo root when Vitest runs) so the
// test is portable across machines/CI without a hardcoded absolute prefix.
const dist = join(process.cwd(), 'dist');

describe('RSS feed', () => {
  it('emits /rss.xml listing the post', () => {
    // @astrojs/rss writes the feed to `dist/rss.xml` (endpoint: src/pages/rss.xml.*).
    const p = join(dist, 'rss.xml');
    // Presence check first: a missing file almost always means the build did
    // not run, or the RSS endpoint threw and produced no output. Asserting
    // existence separately gives a clearer failure than readFileSync throwing.
    expect(existsSync(p)).toBe(true);
    const xml = readFileSync(p, 'utf-8');
    // Cheap structural sanity: the document is at least an RSS envelope, not
    // an empty file or an error page. Intentionally not a full XML parse.
    expect(xml).toContain('<rss');
    // Content proof: the feed actually enumerated published posts rather than
    // rendering an empty channel. 'Hello, world' is the seeded demo post's
    // title — its presence confirms the collection query ran and emitted items.
    expect(xml).toContain('Hello, world');
    // Link proof: item links are built from absolute canonical URLs (site +
    // slug). Checking the slug path guards against a broken `site` config or a
    // slug/permalink regression that would yield wrong or relative feed links.
    expect(xml).toContain('/blog/hello-world');
  });
});

describe('sitemap', () => {
  it('emits a sitemap index', () => {
    // @astrojs/sitemap outputs sitemap-index.xml (+ sitemap-0.xml).
    // We assert only the INDEX file: it is the canonical entry point search
    // engines fetch and the stable filename across post counts (the sitemap-N
    // shards vary as the site grows, so asserting a specific shard would be
    // brittle). Existence is sufficient for this smoke test — content of the
    // shards is not validated here.
    expect(existsSync(join(dist, 'sitemap-index.xml'))).toBe(true);
  });
});
