/**
 * tests/tags.test.ts
 * ==================================================================
 * WHAT THIS FILE IS
 * ------------------------------------------------------------------
 * A Vitest suite that verifies the blog's *tag taxonomy* was rendered
 * correctly by a completed Astro production build. It is a post-build
 * "smoke test" over the emitted static HTML in `dist/`, not a unit
 * test of any source module. Nothing here imports application code:
 * it only reads files off disk and asserts on their string contents.
 *
 * SINGLE RESPONSIBILITY
 * ------------------------------------------------------------------
 * Prove that the three artifacts of the tag feature exist and are
 * wired together after `astro build`:
 *   1. A per-tag listing page      -> dist/blog/tags/<tag>/index.html
 *   2. A tags index (all tags)     -> dist/blog/tags/index.html
 *   3. Back-links from a post page -> the post links to its tag page
 * If any of these regress (e.g. a `getStaticPaths` change stops
 * emitting per-tag routes, or the post template drops its tag links),
 * one of these assertions fails.
 *
 * HOW IT FITS THE ARCHITECTURE
 * ------------------------------------------------------------------
 * The project is a static Astro site deployed to Cloudflare Pages.
 * Tag pages are generated at build time from post frontmatter via
 * Astro dynamic routes (`src/pages/blog/tags/...`). This test is the
 * safety net that those generated routes actually landed in `dist/`.
 * It exercises the *output* of the build, so it is meaningless (and
 * will fail with ENOENT) unless `astro build` has already run and
 * populated `dist/`. In CI the ordering is: build -> vitest.
 *
 * DEPENDENCIES
 * ------------------------------------------------------------------
 *  - vitest            : describe/it/expect test runner + assertions.
 *  - node:fs           : synchronous file reads / existence checks.
 *  - node:path         : cross-platform path joining (matters on the
 *                        Windows dev box; forward-slash literals below
 *                        are normalized by join()).
 *  - The `dist/` folder: the real, load-bearing dependency. Produced
 *                        by `astro build`. Not code we import — data
 *                        we read.
 *
 * WHAT DEPENDS ON THIS FILE
 * ------------------------------------------------------------------
 * Nothing imports it. It is auto-discovered by Vitest's `*.test.ts`
 * glob and run as part of the test command.
 *
 * SECURITY / RLS / SECRETS
 * ------------------------------------------------------------------
 * None. This suite touches only public, pre-rendered static HTML —
 * no Supabase, no RLS, no tokens, no entitlement or paywall logic,
 * no network. It is safe to run anywhere `dist/` exists.
 *
 * GOTCHAS
 * ------------------------------------------------------------------
 *  - Depends on FIXTURE CONTENT: the assertions hard-code the sample
 *    post ("Hello, world" body, `hello-world` slug, `meta` tag). If
 *    that seed post is renamed/retagged/removed, these tests break
 *    even though the tag feature itself is fine. Treat the fixture as
 *    part of the test contract.
 *  - Substring, not DOM, assertions: `.toContain(...)` matches raw
 *    HTML text. It is deliberately loose/robust to markup changes but
 *    can theoretically match an unintended coincidental substring.
 *  - Requires a prior build: run `astro build` first or every read()
 *    throws ENOENT.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Root of the build output. `process.cwd()` is the repo root when
// Vitest is launched via the project's npm script, so `dist` resolves
// to the same folder `astro build` writes to.
const dist = join(process.cwd(), 'dist');
// Read a built file's UTF-8 text by its path *relative to dist/*.
// Throws (ENOENT) if the build didn't emit it — an intentional hard
// failure, since a missing page is itself a regression.
const read = (p: string) => readFileSync(join(dist, p), 'utf-8');
// Existence check relative to dist/ — used where we want a clean
// boolean assertion ("was this route emitted at all?") rather than a
// throw, so the failure message names the missing page instead of a
// raw filesystem error.
const exists = (p: string) => existsSync(join(dist, p));

describe('blog tags', () => {
  it('builds a per-tag page listing its posts', () => {
    // The `meta` tag must have its own generated route, and that page
    // must actually list the seed post (matched by its body text
    // "Hello, world"). Together these prove getStaticPaths emitted the
    // tag AND populated it with the right posts — not just an empty
    // shell.
    expect(exists('blog/tags/meta/index.html')).toBe(true);
    expect(read('blog/tags/meta/index.html')).toContain('Hello, world');
  });

  it('builds a tags index listing the tag', () => {
    // The top-level tags directory page must exist and surface `meta`,
    // confirming the tag-cloud/index aggregation includes tags in use.
    expect(exists('blog/tags/index.html')).toBe(true);
    expect(read('blog/tags/index.html')).toContain('meta');
  });

  it('links tags from the post page', () => {
    // The reverse link: an individual post page must link back to its
    // tag's page. Guards against the post template rendering tag names
    // as plain text without hrefs (which would break navigation and
    // internal linking / SEO).
    expect(read('blog/hello-world/index.html')).toContain('/blog/tags/meta');
  });
});
