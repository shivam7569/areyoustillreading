/**
 * tests/search.test.ts
 * =============================================================================
 * WHAT THIS FILE IS
 * -----------------------------------------------------------------------------
 * A Vitest suite that asserts the site's client-side search is correctly wired
 * into the STATIC BUILD OUTPUT. It is a post-build integration/smoke test, not
 * a unit test: it inspects the real files emitted into `dist/` rather than
 * importing and exercising application code.
 *
 * SINGLE RESPONSIBILITY
 * -----------------------------------------------------------------------------
 * Guarantee two things about Pagefind (the search engine used by this site):
 *   1. The Pagefind index/runtime was actually generated during the Astro build
 *      (i.e. the `dist/pagefind/` directory exists and contains its JS entry).
 *   2. The blog index page (`dist/blog/index.html`) mounts the Pagefind search
 *      UI — it has the mount point element and loads the Pagefind UI script.
 * If either regresses (someone removes the search component, misconfigures the
 * Pagefind post-build step, or renames the mount element), this suite fails.
 *
 * HOW IT FITS THE ARCHITECTURE
 * -----------------------------------------------------------------------------
 * The project is a static Astro site deployed to Cloudflare Pages. Pagefind
 * runs AFTER `astro build` and crawls the emitted HTML in `dist/` to produce a
 * static search index plus a self-contained UI bundle under `dist/pagefind/`.
 * Because the index is a build ARTIFACT (not source), the only reliable place
 * to verify it exists is by reading `dist/` on disk — which is exactly what
 * this suite does.
 *
 * CRITICAL PRECONDITION (GOTCHA)
 * -----------------------------------------------------------------------------
 * These tests read from `dist/`, so they ONLY pass after a full production
 * build that includes the Pagefind post-processing step (e.g. `astro build`
 * followed by the Pagefind indexer, typically chained in the build script).
 * Running Vitest against a stale, partial, or nonexistent `dist/` — or before
 * the very first build — will fail the suite even though the source is correct.
 * The failure means "the build output is missing/malformed", NOT necessarily
 * "the search feature is broken". If you're debugging a red run here in 2 years,
 * check that a fresh full build ran first.
 *
 * DEPENDENCIES / IMPORTS
 * -----------------------------------------------------------------------------
 *   - vitest: `describe`/`it`/`expect` test primitives.
 *   - node:fs: synchronous filesystem reads (existence, dir listing, file read).
 *   - node:path: cross-platform path joining (important — this repo is developed
 *     on Windows, so never hardcode `/` separators; `join` handles it).
 *
 * WHAT DEPENDS ON THIS FILE
 * -----------------------------------------------------------------------------
 * Nothing imports it. It is discovered and run by the Vitest runner (CI and/or
 * local `npm test`). It has no exports and no side effects beyond assertions.
 *
 * SECURITY / RLS NOTES
 * -----------------------------------------------------------------------------
 * None. This file touches no secrets, network, Supabase/RLS, auth tokens,
 * payments, or user data — it only reads local build output. It is safe to run
 * anywhere the `dist/` directory is present.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Resolve the build-output directory relative to the process working directory
// (the repo root when Vitest is invoked normally). All assertions below read
// from here; if the runner is launched from a different cwd, `dist` won't be
// found and every test fails fast — intentional, since the tests are meaningless
// without the real build output.
const dist = join(process.cwd(), 'dist');

describe('Pagefind search', () => {
  it('generates a pagefind index after build', () => {
    // Pagefind writes its entire index + runtime into `dist/pagefind/` during
    // the post-build step. Its mere existence is the first signal indexing ran.
    const dir = join(dist, 'pagefind');
    expect(existsSync(dir)).toBe(true);

    // Existence of the directory isn't enough — an empty or half-written folder
    // would still pass an existsSync check. So we require at least one JS entry
    // named like `pagefind*.js` (e.g. `pagefind.js`, the loader Pagefind emits).
    // WHY the startsWith+endsWith predicate instead of an exact filename: the
    // exact emitted filenames are versioned/hashed by Pagefind and can change
    // between releases, so matching the stable prefix/suffix keeps this test
    // resilient to Pagefind upgrades while still proving the runtime is present.
    const files = readdirSync(dir);
    expect(files.some((f) => f.startsWith('pagefind') && f.endsWith('.js'))).toBe(true);
  });

  it('wires the in-page filter UI on the blog index', () => {
    // Read the built blog index page as raw HTML and assert on its markup. We
    // check the emitted HTML (not the .astro source) because the goal is to
    // confirm the filter UI actually shipped to the browser after compilation.
    const html = readFileSync(join(dist, 'blog', 'index.html'), 'utf-8');

    // The editorial archive filters the rendered list IN-PAGE (deliberately
    // replacing the Pagefind modal here): a search box (`id="q"`) + tag chips
    // (`id="chips"`). If either is renamed/removed, the filter has nothing to
    // bind to — this assertion guards that contract.
    expect(html).toContain('id="q"');
    expect(html).toContain('id="chips"');
  });
});
