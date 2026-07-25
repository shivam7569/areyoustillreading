/**
 * tests/resume.test.ts
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE IS
 *   A Vitest suite that acts as a build-output smoke test for the statically
 *   rendered `/resume` page. It asserts that the page compiles to HTML at all,
 *   and that a few load-bearing pieces of content survived the Astro build.
 *
 * SINGLE RESPONSIBILITY
 *   Verify the *rendered artifact* of the resume page — nothing else. It does
 *   NOT test components in isolation, hit a dev server, or exercise any runtime
 *   (no Pages Functions, no Supabase, no network). It only reads a file that a
 *   prior `astro build` produced and inspects its HTML string.
 *
 * HOW IT FITS THE ARCHITECTURE
 *   This is a static Astro 7 site deployed to Cloudflare Pages. `astro build`
 *   emits the site into `dist/`. The resume page (its source lives at
 *   `src/pages/resume.astro` or an equivalent route) is pre-rendered to
 *   `dist/resume/index.html`. This test is the last-line guard that a routine
 *   refactor, template change, or content edit didn't silently break the
 *   resume route before it ships via `npm run deploy` (Wrangler direct upload).
 *
 * CRITICAL PRECONDITION (the #1 gotcha)
 *   These tests read from `dist/`, so they only pass if the site has ALREADY
 *   been built in this working tree. A fresh checkout, a cleaned `dist/`, or
 *   running Vitest without a preceding `astro build` will make even the "builds"
 *   case fail with a missing-file assertion — the failure means "not built",
 *   not necessarily "page is broken." CI must run the build step before this.
 *   There is no test-time build hook here; the test is intentionally cheap and
 *   assumes the artifact exists.
 *
 * IMPORTS / DEPENDENCIES
 *   - vitest: describe/it/expect test runner primitives.
 *   - node:fs (readFileSync, existsSync): synchronous filesystem reads. Sync is
 *     fine here — this is a tiny local file and the test body is trivial.
 *   - node:path (join): builds an OS-correct absolute path (matters on Windows,
 *     the dev platform here, where separators differ).
 *
 * WHAT DEPENDS ON THIS
 *   Nothing imports this file. It is a leaf executed by the Vitest runner
 *   (typically via `npm test`) and, ideally, by CI prior to deploy.
 *
 * SECURITY / RLS NOTE
 *   None. The resume page is fully public static content — no auth, no tokens,
 *   no entitlement gating, no Supabase RLS in play. This suite touches only the
 *   local filesystem and asserts on a public HTML string, so there is nothing
 *   sensitive to leak. (Contrast with the paywall/gating tests elsewhere in the
 *   repo, which DO carry leak-protection assertions.)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Absolute path to the built resume page. `process.cwd()` is the repo root when
// Vitest runs, and Astro pretty-URL output nests each route as
// `<route>/index.html` — hence `dist/resume/index.html` rather than a flat file.
// `join` (not string concat) keeps this correct across Windows/POSIX separators.
const file = join(process.cwd(), 'dist', 'resume', 'index.html');

describe('resume page', () => {
  // Existence check kept as its own case so a missing artifact reports as a
  // distinct, unambiguous failure ("didn't build / dist not populated") instead
  // of surfacing later as a confusing readFileSync throw inside the content test.
  it('builds', () => {
    expect(existsSync(file)).toBe(true);
  });

  it('shows the real name and a PDF download link', () => {
    // Read the produced HTML as a raw string and assert on substrings. These are
    // deliberately coarse content contracts, each guarding against a specific
    // real-world regression:
    const html = readFileSync(file, 'utf-8');
    // - The real name must render: catches accidental placeholder text, an empty
    //   data binding, or a broken layout that drops the page heading.
    expect(html).toContain('Shivam Chaudhary');
    // - The PDF download must point at the exact public asset path. If the link
    //   href changes or the asset is renamed/removed, the "Download resume"
    //   affordance silently 404s in production — this pins it.
    expect(html).toContain('href="/resume.pdf"');
    // - A known section label ("Experience") proves the body actually rendered,
    //   not just the header/shell. Guards against a template that builds an empty
    //   or truncated page.
    expect(html).toContain('Experience');
  });
});
