/**
 * tests/seo-extras.test.ts
 * =============================================================================
 * WHAT THIS FILE IS
 * -----------------------------------------------------------------------------
 * A Vitest suite of build-artifact ("golden output") assertions that guard two
 * small-but-easy-to-silently-break SEO deliverables produced by the Astro
 * static build: the site's `robots.txt` and its custom `404.html` page.
 *
 * SINGLE RESPONSIBILITY
 * -----------------------------------------------------------------------------
 * Verify that `npm run build` actually EMITTED these two files into `dist/` and
 * that each contains the one substring that proves it is wired up correctly:
 *   - robots.txt must reference the sitemap index, so crawlers can discover it.
 *   - 404.html must be the real, content-bearing error page (not an empty stub).
 * This file asserts nothing about runtime behavior, styling, or the app — only
 * that the build produced the expected on-disk output.
 *
 * HOW IT FITS THE ARCHITECTURE
 * -----------------------------------------------------------------------------
 * The project is a static Astro site deployed to Cloudflare Pages via Wrangler
 * direct upload (`npm run deploy`). SEO plumbing (robots.txt, the sitemap via
 * @astrojs/sitemap, RSS, OG images) is generated at BUILD time and shipped as
 * static files. Because these are generated artifacts — not hand-written source
 * anyone opens regularly — a misconfiguration (e.g. a renamed sitemap file, a
 * dropped integration, a 404 route that stops rendering) would ship silently
 * and only surface weeks later as lost crawl coverage or ugly error pages.
 * This suite is the tripwire: it runs against `dist/` AFTER a build and fails
 * fast in CI if either artifact is missing or degraded.
 *
 * PRECONDITION / ORDERING GOTCHA (IMPORTANT)
 * -----------------------------------------------------------------------------
 * These tests read from `dist/`, so they are meaningless — and will fail — if
 * the site has not been built first. They assume the CI/test pipeline runs the
 * Astro build BEFORE `vitest`. Running `vitest` in isolation on a clean checkout
 * (no `dist/`) will fail on `existsSync(...) === true`; that is by design, not a
 * flaky test. If you see these failing locally, run the build first.
 *
 * DEPENDENCIES
 * -----------------------------------------------------------------------------
 *   - vitest: `describe`/`it`/`expect` test primitives.
 *   - node:fs (`readFileSync`, `existsSync`): read the built artifacts.
 *   - node:path (`join`): OS-safe path construction (this repo is developed on
 *     Windows, so forward-slash string paths must NOT be hard-coded).
 * Implicitly depends on the Astro build config: the sitemap integration (which
 * names the file `sitemap-index.xml`), the robots.txt generation, and the
 * presence of a `src/pages/404.astro` route.
 *
 * WHAT DEPENDS ON THIS FILE
 * -----------------------------------------------------------------------------
 * Nothing imports it; it is a leaf test module discovered and run by Vitest.
 *
 * SECURITY / RLS NOTE
 * -----------------------------------------------------------------------------
 * None. This suite touches only public, static, non-sensitive build output —
 * no Supabase, no auth, no tokens, no entitlement/paywall logic. It is purely
 * a build-integrity guard.
 * =============================================================================
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Root of the Astro build output. `process.cwd()` is the repo root when Vitest
// runs, so this resolves to the same `dist/` the deploy step uploads. Computed
// once and shared by both tests. NOTE: this is a build-time snapshot dir, not a
// dev-server path — see the "PRECONDITION" note above.
const dist = join(process.cwd(), 'dist');

describe('SEO extras', () => {
  it('emits robots.txt pointing at the sitemap', () => {
    const p = join(dist, 'robots.txt');
    // First prove the file exists at all: catches a dropped/renamed robots.txt
    // generation step before we try to read it (readFileSync on a missing file
    // would throw an opaque ENOENT instead of a clear assertion failure).
    expect(existsSync(p)).toBe(true);
    // Then prove it is USEFUL: it must advertise the sitemap index so crawlers
    // can discover every page. `sitemap-index.xml` is the specific filename the
    // @astrojs/sitemap integration emits; if that integration is removed or the
    // filename changes, this substring check fails and flags the SEO regression.
    expect(readFileSync(p, 'utf-8')).toContain('sitemap-index.xml');
  });

  it('builds a styled 404 page', () => {
    const p = join(dist, '404.html');
    // Custom 404s must be pre-rendered to a static `404.html` so Cloudflare
    // Pages serves them for unknown routes. Confirm the file was emitted...
    expect(existsSync(p)).toBe(true);
    // ...and that it is the real error page, not an empty shell. Asserting the
    // literal "404" appears is a cheap sentinel that the page rendered actual
    // content (heading/status text) rather than building to a blank document.
    expect(readFileSync(p, 'utf-8')).toContain('404');
  });
});
