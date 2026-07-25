/**
 * tests/smoke.test.ts — Post-build "did the site actually compile?" smoke test.
 *
 * SINGLE RESPONSIBILITY
 * ---------------------
 * Assert that an Astro production build produced a non-trivial homepage at
 * `dist/index.html`. This is the cheapest possible signal that the static build
 * pipeline ran end-to-end without silently emitting nothing (or a broken shell).
 * It is intentionally shallow: it does NOT validate content, routes, styling,
 * data, or any backend behavior — only that the build emitted a real HTML page.
 *
 * WHERE IT FITS IN THE ARCHITECTURE
 * ---------------------------------
 * The project is a static Astro 7 blog + portfolio deployed to Cloudflare Pages
 * via Wrangler direct upload (`npm run deploy`). Everything dynamic (auth,
 * paywall, email, etc.) lives in Cloudflare Pages Functions + Supabase and is
 * NOT exercised here. This test guards the one artifact that upload ships: the
 * compiled `dist/` directory. Run it AFTER `astro build` (e.g. as a pre-deploy
 * gate) so a build that emits no homepage fails fast rather than deploying a
 * blank site.
 *
 * RUNNER & DEPENDENCIES
 * ---------------------
 * - Runner: Vitest (`describe`/`it`/`expect`). Executed via `vitest run`.
 * - Node built-ins only: `node:fs` (existence + read) and `node:path` (join).
 *   No Astro, Supabase, or network dependency — this must run in a bare Node
 *   context so it works in CI even when secrets/services are unavailable.
 *
 * WHAT DEPENDS ON THIS
 * --------------------
 * The CI / pre-deploy step (whatever invokes the test suite). Nothing imports
 * this file as a module; it is a leaf test.
 *
 * ORDERING GOTCHA / PRECONDITION
 * ------------------------------
 * This test reads from disk — it does NOT trigger a build. If `astro build` has
 * not run (or ran into a different output dir), `dist/index.html` won't exist
 * and the first assertion fails. That failure is the intended behavior: "no
 * build output" and "broken build output" both mean do-not-deploy.
 *
 * SECURITY NOTE
 * -------------
 * This test touches only local build artifacts and asserts no secrets — there is
 * no token, entitlement, or RLS surface here. It is deliberately kept free of
 * any Supabase/Dodo/Resend imports so it cannot leak or depend on credentials.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Resolve `dist/` relative to the process working directory (the repo root when
// Vitest is launched from `npm test`/`npm run deploy`). Using cwd rather than a
// path relative to this file keeps it aligned with Astro's default output dir,
// which is emitted at the project root.
const dist = join(process.cwd(), 'dist');

describe('build smoke test', () => {
  it('emits a homepage', () => {
    // The homepage is Astro's guaranteed root-route output. If the build ran at
    // all, `index.html` is the first thing it should have produced.
    const file = join(dist, 'index.html');

    // 1) The file must exist. A missing homepage means the build never ran, ran
    //    into an error before writing output, or wrote to an unexpected dir —
    //    all cases where deploying would ship a broken/empty site.
    expect(existsSync(file)).toBe(true);

    const html = readFileSync(file, 'utf-8');

    // 2) It must look like real HTML. `<html` (note: prefix match, so it accepts
    //    `<html>`, `<html lang="en">`, etc.) catches the case where the file
    //    exists but is empty or contains only an error fragment.
    expect(html).toContain('<html');

    // 3) It must be non-trivial. The >50-byte floor is a crude guard against a
    //    truncated/placeholder page slipping through assertion (2). It is a
    //    sanity floor, not a content check — a real Astro page is far larger.
    expect(html.length).toBeGreaterThan(50);
  });
});
