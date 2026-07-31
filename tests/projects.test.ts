/**
 * tests/projects.test.ts
 * =============================================================================
 * WHAT THIS FILE IS
 * -----------------------------------------------------------------------------
 * A Vitest smoke/regression test for the statically-built `/projects` page.
 * Single responsibility: assert that the Astro build actually EMITTED the
 * projects page and that the page HTML contains the expected, real content
 * (as opposed to an empty shell, a 404, or a page that silently lost its
 * project list because of a content-collection or routing regression).
 *
 * HOW IT FITS THE ARCHITECTURE
 * -----------------------------------------------------------------------------
 * This project is a static Astro site deployed to Cloudflare Pages via Wrangler
 * direct upload (`npm run deploy`). `astro build` renders every route to plain
 * HTML under `dist/`. There is NO server, NO Supabase, NO auth, and NO payment
 * logic involved on this route or in this test — the projects page is pure
 * build-time output. This test therefore operates purely on the filesystem:
 * it reads the already-built artifact rather than spinning up a server or a
 * headless browser. That makes it fast, hermetic, and dependency-free.
 *
 * BUILD-ORDER DEPENDENCY (the single most important gotcha):
 *   This test reads `dist/projects/index.html`, which only exists AFTER a
 *   production build has run. It does NOT trigger a build itself. Running
 *   `vitest` against a clean checkout (no `dist/`) will fail the first
 *   assertion. The intended invocation is: `astro build` FIRST, then the test
 *   suite — typically wired together in the CI pipeline / an npm script so the
 *   build always precedes the tests. If you are debugging a spurious "builds"
 *   failure in 2 years, check that `dist/` was produced before Vitest ran
 *   before suspecting the page itself.
 *
 * DEPENDS ON (imports):
 *   - vitest              → test runner primitives (describe/it/expect).
 *   - node:fs             → synchronous filesystem reads (existsSync/readFileSync).
 *   - node:path           → cross-platform path joining (matters on the Windows
 *                           dev box this repo lives on — never hand-concatenate
 *                           with '/').
 *   - The built artifact  → dist/projects/index.html (produced by `astro build`;
 *                           NOT a source import — read at test runtime).
 *
 * DEPENDED ON BY:
 *   - The CI/test run (`vitest`). Nothing imports this module; it is a leaf
 *     test file discovered by Vitest's glob.
 *
 * SECURITY / RLS NOTES
 * -----------------------------------------------------------------------------
 * None. This route carries no secrets, tokens, entitlements, or user data, and
 * this test performs only local, read-only filesystem access. There is no
 * network, no auth, and no database in play — so there is nothing here that
 * Supabase Row-Level Security, Turnstile, Dodo signatures, or honeypots would
 * guard. Keep it that way: if the projects page ever gains gated/paywalled
 * content, that logic (and its leak-protection tests) belongs elsewhere, not
 * bolted onto this pure build-output check.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Resolve the built page relative to the process CWD (the repo root when Vitest
// runs). `join` is used deliberately so the path is correct on Windows as well
// as POSIX CI runners. This points at the STATIC build output, not a source
// file — see the build-order gotcha in the header.
const file = join(process.cwd(), 'dist', 'projects', 'index.html');

describe('projects page', () => {
  // Guards against the "route silently disappeared" failure mode: a broken
  // route config, a renamed page file, or a build that errored out would mean
  // this artifact was never emitted. Asserting existence first also gives a
  // clearer failure than a downstream readFileSync ENOENT.
  it('builds', () => {
    expect(existsSync(file)).toBe(true);
  });

  it('renders the real project', () => {
    // Read the emitted HTML as a raw string; we assert on substrings rather
    // than parsing the DOM — cheap and sufficient for a smoke test.
    const html = readFileSync(file, 'utf-8');
    // Sanity check that this is actually the projects page (heading/title
    // present), catching cases where the file exists but rendered as an empty
    // shell or an error page.
    expect(html).toMatch(/Projects/);
    // The load-bearing assertion: verify a KNOWN real project title made it
    // into the output. This is the regression tripwire — if the content
    // collection fails to load, the project list renders empty, or the data
    // source changes, this exact string vanishes and the test fails loudly.
    // NOTE: this is a hard-coded coupling to real content — if this project is
    // ever renamed or removed from the source, update this expectation to match
    // the new canonical project rather than deleting the assertion.
    expect(html).toContain('Deep-Learning Architectures from Scratch');
    // Case-study redesign markers. Assert on data-attributes/text, NOT class
    // names — Astro appends a scoped-style hash to class lists (class="proj astro-…"),
    // so a `class="proj"` substring would never match.
    expect(html).toContain('data-layout="case"'); // the case-study article
    expect(html).toContain('Architecture families');
    expect(html).toContain('Modular, packaged codebase'); // a "how it's built" item
    expect(html).toContain('<svg'); // inlined generated plate artwork
  });
});
