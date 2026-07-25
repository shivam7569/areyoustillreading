/**
 * tests/home.test.ts
 * =============================================================================
 * WHAT THIS FILE IS
 * -----------------------------------------------------------------------------
 * A Vitest smoke test for the *built* homepage (`dist/index.html`). Its single
 * responsibility is to assert that the two things a visitor must find on the
 * landing page actually survived the Astro build and made it into the shipped
 * HTML: (1) the "Latest posts" feed with at least the canonical seed post, and
 * (2) the newsletter subscribe form wired to the correct backend endpoint.
 *
 * WHY IT EXISTS / HOW IT FITS THE ARCHITECTURE
 * -----------------------------------------------------------------------------
 * This is a static Astro site deployed to Cloudflare Pages via Wrangler direct
 * upload (`npm run deploy`). Astro renders `src/pages/index.astro` down to a
 * fully static `dist/index.html` at build time — there is no server rendering
 * the homepage at request time. That makes the build output the source of
 * truth for what users see, so this test reads the compiled artifact from disk
 * (NOT a dev server, NOT a rendered component) and greps it as plain text.
 *
 * This is deliberately a "post-build" integration check rather than a component
 * unit test: it catches regressions that only appear after the full pipeline
 * runs — a broken content collection query, a renamed slug, a form whose
 * `action` was refactored, or content that got silently dropped by the
 * Markdown/Astro toolchain.
 *
 * DEPENDS ON (must exist / run first):
 *   - `dist/index.html` MUST already exist. This test does NOT build the site;
 *     `npm run build` (astro build) has to run before `vitest`, or every
 *     assertion here throws at import time (see GOTCHA below). In CI the build
 *     step is expected to precede the test step.
 *   - The homepage template `src/pages/index.astro`, which must emit the
 *     literal strings asserted below.
 *   - The blog content collection containing the `hello-world` post, so that
 *     `/blog/hello-world` appears in the rendered "Latest posts" list.
 *   - The subscribe endpoint contract: a Cloudflare Pages Function at
 *     `/api/subscribe` (the form's POST target — the Turnstile + Supabase +
 *     Resend double-opt-in subscribe flow). This test only checks the form is
 *     wired to that path; it does not exercise the function itself.
 *
 * DEPENDED ON BY: nothing imports this file — it is a leaf test module run by
 * the Vitest runner.
 *
 * SECURITY / RELIANCE NOTES
 * -----------------------------------------------------------------------------
 *   - No secrets, auth, RLS, tokens, or entitlement logic are involved here.
 *     This file reads a local build artifact only; it makes no network calls
 *     and touches no Supabase/Dodo/Resend surface. It is safe to run offline.
 *   - The assertions are substring matches, not DOM parses, so they are
 *     intentionally loose: they prove the strings are *present somewhere* in
 *     the HTML, not that they are in valid/visible markup. Keep the asserted
 *     strings specific enough (e.g. the full `action="/api/subscribe"`) that an
 *     incidental match elsewhere in the page cannot mask a real regression.
 *
 * GOTCHA
 * -----------------------------------------------------------------------------
 *   `readFileSync` runs at MODULE LOAD time (top level), before any `describe`
 *   / `it` block executes. If `dist/index.html` is missing, the failure is an
 *   import-time ENOENT, not a clean assertion failure — so a "cannot find
 *   dist/index.html" error means "you forgot to build", not "the homepage is
 *   broken". `process.cwd()` is assumed to be the repo root (Vitest's default),
 *   which is what makes the relative `dist/index.html` path resolve correctly.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Read the compiled homepage ONCE, synchronously, at module load. We treat the
// build output as an opaque string and assert against its raw text below.
// `process.cwd()` is the repo root under Vitest, so this resolves to the
// Astro build artifact produced by `astro build`.
const home = readFileSync(join(process.cwd(), 'dist', 'index.html'), 'utf-8');

describe('homepage', () => {
  it('surfaces the latest posts', () => {
    // The "Latest posts" section heading must render — proves the homepage's
    // content-collection-driven feed block was emitted at all.
    expect(home).toContain('Latest posts');
    // The canonical seed post's URL must appear — proves the feed is actually
    // populated with real entries (not an empty list) and that the
    // `hello-world` slug still resolves. A renamed slug or a broken collection
    // query trips this assertion.
    expect(home).toContain('/blog/hello-world');
  });

  it('includes the subscribe form', () => {
    // The newsletter form must POST to the `/api/subscribe` Pages Function.
    // Asserting the full `action="..."` attribute (not just the path) guards
    // against a refactor that repoints or removes the form's backend wiring,
    // which would silently break the double-opt-in signup flow.
    expect(home).toContain('action="/api/subscribe"');
  });
});
