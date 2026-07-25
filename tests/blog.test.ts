/**
 * tests/blog.test.ts — Build-output smoke test for the Markdown blog pipeline.
 *
 * WHAT THIS FILE IS
 * -----------------
 * A Vitest suite that asserts the STATIC HTML Astro emits into `dist/` for the
 * blog. It does NOT exercise Astro's runtime, a dev server, a browser, or any
 * backend (Supabase / Pages Functions / Dodo / Turnstile / Resend). It reads the
 * already-built files straight off disk and greps their HTML for expected text.
 * In other words: this is a post-build acceptance check on the compiled artifact,
 * not a unit test of any source module.
 *
 * SINGLE RESPONSIBILITY
 * ---------------------
 * Prove that the end-to-end content pipeline for one canonical fixture post
 * ("hello-world") survived the full Astro build:
 *   1. the post is discovered and LISTED on the blog index (`/blog/`), and
 *   2. its Markdown was RENDERED to HTML at its own route (`/blog/hello-world/`).
 * If both hold, the content collection glob, the routing, and the remark/rehype
 * Markdown-to-HTML transform are all wired up correctly.
 *
 * HOW IT FITS THE ARCHITECTURE
 * ----------------------------
 * This is a static Astro 7 site deployed to Cloudflare Pages via Wrangler direct
 * upload (`npm run deploy`). `astro build` compiles content collections + `.astro`
 * pages into a fully pre-rendered `dist/` tree; those exact files are what get
 * uploaded. Because this suite asserts against `dist/`, it validates the literal
 * bytes that ship to production — the strongest guarantee a cheap test can give
 * for a static site. It is the pipeline's canary: if the Markdown toolchain
 * (Shiki, KaTeX, Mermaid, etc.) or the collection routing regresses, the fixture
 * post's HTML changes and one of these assertions fails.
 *
 * PRECONDITION / ORDERING GOTCHA (important, easy to trip over in 2 years)
 * -----------------------------------------------------------------------
 * These tests read from `dist/`, so **`astro build` MUST have run first**. Run
 * bare (e.g. `vitest` on a clean checkout with no `dist/`), every assertion fails
 * — not because the site is broken but because there is nothing to read. The CI /
 * npm script is expected to build before invoking Vitest. `existsSync` is checked
 * first in each test specifically so a missing build fails on the file-presence
 * assertion with a clear signal rather than throwing an opaque ENOENT from
 * `readFileSync` deeper in the test.
 *
 * DEPENDENCIES
 * ------------
 *   - `vitest` — test runner / assertion API (describe/it/expect).
 *   - Node `fs`/`path` — synchronous disk reads; no async needed since the files
 *     already exist on disk by the time the suite runs.
 *   - The fixture content: a source post whose slug is `hello-world` (lives under
 *     the blog content collection). These assertions are COUPLED to that fixture's
 *     literal text ("Hello, world", "A heading", list item "one"). If someone
 *     edits or deletes that fixture, update the expected strings here in lockstep.
 *
 * WHAT DEPENDS ON THIS FILE
 * -------------------------
 * Nothing imports it (it is a leaf test module). It is invoked by the test runner
 * / CI gate. Treat a failure here as "the build output no longer matches the
 * fixture" — investigate the build or the fixture, not this file.
 *
 * SECURITY NOTE
 * -------------
 * No security surface: no network, no auth, no RLS, no tokens, no user input. It
 * only reads local build artifacts. (The paywall/entitlement/token logic lives in
 * Pages Functions + Supabase RLS and is covered by other suites, not here.)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// `process.cwd()` is the repo root when Vitest runs, so `dist/` resolves to the
// Astro build output directory. All three helpers below are scoped to it, so
// every path argument in the tests is written relative to `dist/`.
const dist = join(process.cwd(), 'dist');
// Read a built file as UTF-8 text so assertions can substring-match its HTML.
// Throws if the file is absent — callers guard with `exists()` first (see below).
const read = (p: string) => readFileSync(join(dist, p), 'utf-8');
// Presence check used as a fail-fast guard before `read()`, so a missing build
// (or a routing regression that drops a page) fails on a clear boolean assertion
// rather than an ENOENT thrown from `readFileSync`.
const exists = (p: string) => existsSync(join(dist, p));

describe('blog pipeline', () => {
  // TEST 1 — the index page aggregates and links the post.
  // Verifies the content collection was globbed and the index template iterated
  // it: the title text must appear (proves the entry was found and its
  // frontmatter title rendered) AND a link to the post's route must appear
  // (proves slug-based routing/href generation is correct). Together these show
  // the listing half of the pipeline works. The `exists` guard first ensures the
  // index was emitted at all before we grep its contents.
  it('lists the post on the blog index', () => {
    expect(exists('blog/index.html')).toBe(true);
    const html = read('blog/index.html');
    expect(html).toContain('Hello, world');       // frontmatter title surfaced on the index
    expect(html).toContain('/blog/hello-world');   // link points at the generated per-post route
  });

  // TEST 2 — the per-post page rendered Markdown → HTML correctly.
  // The three assertions each probe a distinct Markdown construct so a partial
  // pipeline break is caught precisely:
  //   - `<h1>Hello, world</h1>` : a `#` heading became a real <h1> element (not
  //     left as raw `#` text) — the core Markdown transform ran.
  //   - "A heading"             : body prose survived into the output.
  //   - `<li>one</li>`          : list syntax became a proper <li> — list parsing
  //     works, not just paragraphs.
  // Asserting on rendered TAGS (not raw Markdown) is deliberate: it confirms the
  // remark/rehype pipeline actually executed rather than passing Markdown through.
  it('renders the post markdown to HTML', () => {
    expect(exists('blog/hello-world/index.html')).toBe(true);
    const html = read('blog/hello-world/index.html');
    expect(html).toContain('<h1>Hello, world</h1>'); // heading transformed to real element
    expect(html).toContain('A heading');             // body text preserved
    expect(html).toContain('<li>one</li>');          // list item transformed to real element
  });
});
