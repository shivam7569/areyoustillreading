/**
 * tests/seo.test.ts — Post-build SEO / social-metadata smoke test.
 *
 * WHAT THIS FILE IS
 * -----------------
 * A Vitest suite that asserts the *rendered static HTML output* of the site
 * carries the essential SEO and social-sharing `<head>` tags. It does NOT test
 * source `.astro` components — it inspects the final artifacts Astro emits into
 * the `dist/` directory. This makes it an end-to-end guard: if the build
 * pipeline, a layout refactor, or a dependency bump ever drops these tags, this
 * test fails instead of the regression silently shipping to Cloudflare Pages.
 *
 * SINGLE RESPONSIBILITY
 * ---------------------
 * Verify that representative built pages expose OpenGraph (`og:*`), Twitter Card
 * (`twitter:*`), and a canonical URL (`rel="canonical"`). Nothing else — no
 * link-checking, no schema validation, no visual assertions. It is intentionally
 * a shallow "the tags exist" check, not a "the tag values are correct" check.
 *
 * HOW IT FITS THE ARCHITECTURE
 * ----------------------------
 * The project is a static Astro build deployed to Cloudflare Pages via Wrangler
 * direct upload (`npm run deploy`). SEO/OG tags are injected by shared Astro
 * layout components (and OG images by astro-og-canvas). Because those tags are a
 * silent, easily-broken cross-cutting concern — nothing on the page *looks*
 * broken if `og:title` disappears — this test locks them in. It belongs to the
 * pre-deploy verification story: it only produces meaningful results after a
 * production build has populated `dist/`.
 *
 * CRITICAL PRECONDITION / GOTCHA
 * ------------------------------
 * This suite reads from `dist/` on disk. It assumes `astro build` (i.e.
 * `npm run build`) has already run and produced those files. If you run it
 * against a stale or missing `dist/`, the `read()` helper throws ENOENT (test
 * error, not a clean assertion failure) or — worse — asserts against outdated
 * HTML. The suite must therefore be sequenced AFTER the build in CI, never
 * standalone. There is no dev-server or SSR involved; it is pure filesystem I/O.
 *
 * DEPENDENCIES
 * ------------
 * - `vitest` — test runner / assertion library (describe/it/expect).
 * - `node:fs` `readFileSync` + `node:path` `join` — synchronous file reads;
 *   sync is fine here because these are tiny files in a fast, isolated test.
 * - Implicitly depends on the build output layout under `dist/` and on the
 *   existence of the specific sample pages listed below.
 *
 * WHAT DEPENDS ON THIS FILE
 * -------------------------
 * Nothing imports it (it is a leaf test). CI / `npm test` (Vitest) discovers and
 * runs it. It has no bearing on the shipped bundle.
 *
 * SECURITY NOTE
 * -------------
 * Read-only, build-artifact-only. No secrets, no network, no Supabase/RLS,
 * no tokens, no Pages Functions. Nothing security-sensitive lives here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Read a built HTML file from the `dist/` output directory as UTF-8 text.
 *
 * `process.cwd()` is the repo root when Vitest runs, so paths are resolved
 * relative to `<repo>/dist/<p>`. WHY sync + `join`: keeps the test terse and
 * OS-agnostic (correct path separators on Windows/Cloudflare CI alike).
 *
 * GOTCHA: this throws if the file is absent (build not run / page renamed),
 * which surfaces as a test *error* rather than a failed `expect` — that loud
 * failure is intentional, it means "you forgot to build" not "SEO is broken".
 *
 * @param p dist-relative path to an emitted HTML file.
 * @returns Raw HTML source of that page.
 */
const read = (p: string) => readFileSync(join(process.cwd(), 'dist', p), 'utf-8');

describe('SEO / OpenGraph', () => {
  // Sample two representative page *shapes*, not every page — checking all pages
  // would be slow and redundant since the tags come from shared layouts:
  //   - 'index.html'                    -> the site homepage (top-level route).
  //   - 'blog/hello-world/index.html'   -> a rendered blog post (content route).
  // If both a static page and a content-collection page carry the tags, the
  // shared layout is doing its job everywhere. NOTE: 'hello-world' is a hard
  // dependency — if that seed/sample post is ever removed or renamed, update
  // this list or the suite will error on a missing file.
  for (const page of ['index.html', 'blog/hello-world/index.html']) {
    it(`emits OG + Twitter + canonical on ${page}`, () => {
      const html = read(page);
      // Substring checks (not DOM parsing) are deliberate: cheap, dependency-free,
      // and sufficient to prove the attribute was rendered into the markup.
      expect(html).toContain('property="og:title"');       // OG title for link previews.
      expect(html).toContain('property="og:description"');  // OG description snippet.
      expect(html).toContain('name="twitter:card"');        // Twitter/X card type marker.
      expect(html).toContain('rel="canonical"');            // Canonical URL — dedupes SEO signals.
    });
  }
});
