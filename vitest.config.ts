/**
 * vitest.config.ts — Vitest test-runner configuration for areyoustillreading.dev.
 *
 * SINGLE RESPONSIBILITY
 *   Configure how the Vitest test suite runs. Nothing else: it declares no
 *   tests itself, only the runner's global behavior (setup hook, file glob,
 *   timeouts).
 *
 * WHERE THIS FITS IN THE ARCHITECTURE
 *   The project is a static Astro site deployed to Cloudflare Pages. The test
 *   suite here is a "build-then-assert" integration suite: rather than unit-
 *   testing components in isolation, the tests run a real production build
 *   (`astro build`) once, then make assertions against the emitted `dist/`
 *   output — e.g. verifying that paywalled/gated content is NOT leaked into the
 *   static HTML, that preview/gateable post flags render correctly, and that
 *   OG/RSS/sitemap artifacts exist. This is the safety net that catches content
 *   leaks before they ship (see the Phase 3 content-gating commits).
 *
 * DEPENDENCIES (what this imports / relies on)
 *   - `vitest/config` → `defineConfig`: typed config helper from Vitest.
 *   - `./tests/global-setup.ts`: the referenced global-setup module. It runs
 *     ONCE before the whole suite (not per-file, not per-test) and is expected
 *     to produce the `dist/` build the tests read from. If that file is moved
 *     or renamed, update the path below.
 *   - the tests/ test-file glob (see the `include` option below): the files collected.
 *
 * WHAT DEPENDS ON THIS
 *   - The `vitest` / `npm test` invocation (package.json scripts) auto-loads
 *     this file by name — Vitest discovers `vitest.config.ts` in the project
 *     root. No other module imports it.
 *
 * SECURITY NOTE / WHY THIS MATTERS
 *   These tests are the leak-protection guardrail for the paywall. Weakening
 *   the timeouts or the setup hook so the build is skipped would let the suite
 *   pass against stale or missing output, defeating the check. Keep the build
 *   step (globalSetup) authoritative.
 *
 * GOTCHA: the two timeouts below serve very different phases and must not be
 * conflated — see inline notes.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Build the site once before the entire suite, then assert against dist/.
    // WHY globalSetup (not beforeAll/setupFiles): globalSetup runs a single
    // time for the whole run, in a separate context, before any test file is
    // imported. Running `astro build` is expensive, so we pay it exactly once
    // and let every test read the same emitted dist/ output. An array is used
    // because Vitest accepts multiple setup modules; only one is needed here.
    globalSetup: ['./tests/global-setup.ts'],
    // Only collect *.test.ts under tests/. Keeps helpers/fixtures that live
    // alongside tests (e.g. global-setup.ts itself) from being treated as
    // test files and executed as suites.
    include: ['tests/**/*.test.ts'],
    // Per-test budget: 20s. Generous because individual assertions may crawl
    // the built dist/ tree (file reads, HTML parsing) rather than run in-memory.
    testTimeout: 20000,
    // Hook budget: 120s. This is deliberately much larger than testTimeout
    // because it covers the globalSetup hook — i.e. the full `astro build`,
    // which (Shiki syntax highlighting, KaTeX math, build-time D2 diagram
    // rendering via @terrastruct/d2 — which replaced the older Mermaid setup —
    // Pagefind indexing, astro-og-canvas OG image generation) can take tens of
    // seconds cold. A short hook timeout here would flakily
    // abort the build and fail the whole suite spuriously. Do NOT lower this to
    // match testTimeout; they measure different things.
    hookTimeout: 120000,
  },
});
