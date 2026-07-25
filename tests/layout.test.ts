/**
 * tests/layout.test.ts
 * =====================
 *
 * WHAT THIS FILE IS
 * -----------------
 * A Vitest suite that asserts the *built* HTML shell of the site is intact.
 * Its single responsibility is to smoke-test the global page chrome — the base
 * layout, its navigation, its stylesheet wiring, and its footer — as they
 * appear in the production build's home page (`dist/index.html`).
 *
 * It is a build-artifact test, NOT a component/unit test. It deliberately reads
 * the final rendered HTML off disk rather than importing an Astro component,
 * because the base layout (`src/layouts/*.astro`) is a `.astro` file that only
 * exists as HTML after the Astro compiler runs. This catches regressions that
 * unit tests miss: broken nav hrefs, a stylesheet that failed to bundle/inline,
 * or a footer that silently disappeared from the layout.
 *
 * HOW IT FITS THE ARCHITECTURE
 * ----------------------------
 * The project is a static Astro site deployed to Cloudflare Pages via Wrangler
 * direct upload (`npm run deploy`). `astro build` emits the whole site into
 * `dist/`, and `dist/index.html` is the compiled home page — the ground truth
 * for what actually ships to the browser. This test treats that file as its
 * fixture: whatever the base layout wraps every page in should be observable in
 * the home page's HTML.
 *
 * CRITICAL PRECONDITION (GOTCHA)
 * ------------------------------
 * `dist/index.html` MUST exist before this suite runs, i.e. `astro build` has
 * to have run first. If the build hasn't happened (or was cleaned), the
 * top-level `readFileSync` throws ENOENT at module-load time and the ENTIRE
 * suite errors out before any `it()` executes. The npm test script is expected
 * to sequence `build` ahead of `vitest`; running `vitest` in isolation on a
 * clean tree will fail here — that's by design, not a flaky test.
 *
 * DEPENDENCIES
 * ------------
 * - `vitest`            — test runner / assertion library.
 * - `node:fs`, `node:path` — read the build artifact from disk.
 * - Implicit input: `dist/index.html` produced by `astro build`.
 * - Implicit input: `src/layouts/*.astro` (the base layout) whose output this
 *   asserts, and the nav component that renders the section links.
 *
 * WHAT DEPENDS ON THIS FILE
 * -------------------------
 * Nothing imports it — it is a leaf test module discovered and executed by
 * Vitest (and by CI before deploy). It has no runtime role in the shipped site.
 *
 * SECURITY NOTE
 * -------------
 * Purely a read-only assertion over a local build artifact. No secrets, no
 * network, no Supabase/RLS, no auth, no payment surface is exercised here — so
 * there are no token, entitlement, signature, or honeypot concerns in this file.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Read the compiled home page ONCE at module load and share it across all
// specs. WHY module scope: the file never changes during a run, so re-reading
// per test would be wasteful. Trade-off: a missing `dist/index.html` throws
// here (before any test body), failing the whole suite — see "CRITICAL
// PRECONDITION" above. `process.cwd()` is the project root under Vitest, so
// `dist/index.html` resolves to the freshly built home page.
const home = readFileSync(join(process.cwd(), 'dist', 'index.html'), 'utf-8');

describe('base layout + nav', () => {
  it('renders nav links to every top-level section', () => {
    // The base layout's nav must link to all three top-level sections. We match
    // the literal `href="..."` substring rather than parsing the DOM: cheap,
    // and it fails loudly if a route is renamed/removed or the nav is dropped
    // from the layout. WHY these three: /blog, /projects, /resume are the
    // site's primary sections; a broken link here means dead navigation on
    // every page that uses the base layout.
    for (const href of ['/blog', '/projects', '/resume']) {
      expect(home).toContain(`href="${href}"`);
    }
  });

  it('bundles the global stylesheet', () => {
    // Astro either inlines critical CSS in a <style> tag or links a bundled sheet.
    // WHY an either/or regex: depending on stylesheet size and Astro's inlining
    // heuristics, the CSS may ship as an inline `<style>` block OR as a
    // `<link rel="stylesheet">`. Both are valid "styles made it into the build"
    // outcomes, so we accept either. A failure here means the global styles
    // never got wired into the page at all — an unstyled ship.
    expect(home).toMatch(/<style|rel="stylesheet"/);
  });

  it('renders the site footer', () => {
    // The footer carries the site name ("areyoustillreading"). Asserting the
    // string is a proxy for "the layout's footer partial rendered". If the
    // footer is removed or the layout stops wrapping pages, this string vanishes
    // and the test catches the regression. Kept intentionally loose (substring,
    // not exact markup) so cosmetic footer edits don't break the smoke test.
    expect(home).toContain('areyoustillreading');
  });
});
