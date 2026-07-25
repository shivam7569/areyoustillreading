/**
 * tests/markdown.test.ts
 * -----------------------------------------------------------------------------
 * WHAT THIS FILE IS
 *   A Vitest integration/smoke test that asserts the site's Markdown rendering
 *   pipeline actually produced the expected HTML for a known blog post
 *   (`/blog/hello-world/`). It is a *post-build* test: it reads a static file
 *   that Astro emitted into `dist/`, not a component or module under test.
 *
 * SINGLE RESPONSIBILITY
 *   Verify two build-time guarantees on the rendered output of one canary post:
 *     1. Fenced code blocks are syntax-highlighted by Shiki (Astro's default
 *        highlighter), evidenced by the `astro-code` wrapper class.
 *     2. The page surfaces an estimated reading time (e.g. "3 min read"),
 *        which is injected by our reading-time remark/layout logic.
 *   It does NOT test KaTeX, Mermaid, RSS, OG images, or the dynamic backend
 *   (Supabase / Pages Functions / paywall) — only the core Markdown → HTML step.
 *
 * HOW IT FITS THE ARCHITECTURE
 *   The project is a static Astro build deployed to Cloudflare Pages. The
 *   Markdown pipeline (Shiki + KaTeX + build-time Mermaid + reading time) runs
 *   at `astro build` and writes finished HTML into `dist/`. This test consumes
 *   that emitted artifact, so it functions as a regression guard: if someone
 *   swaps the highlighter, disables Shiki, or removes the reading-time metric,
 *   the rendered HTML changes and these assertions fail.
 *
 * DEPENDENCIES / IMPORTS
 *   - vitest: `describe`/`it`/`expect` test primitives.
 *   - node:fs `readFileSync` + node:path `join`: read the built HTML off disk.
 *   No app code is imported — the coupling is purely to the on-disk build output.
 *
 * WHAT DEPENDS ON THIS FILE
 *   Only the test runner (`vitest`, typically via `npm test`). Nothing in the
 *   app imports it. It has no runtime effect on the shipped site.
 *
 * CRITICAL PRECONDITION / GOTCHA
 *   The `dist/` artifact must already exist. `readFileSync` runs at *module
 *   load time* (top level, below), before any test body — so if `astro build`
 *   has not been run, this whole file throws ENOENT during collection and every
 *   test errors out (not a clean assertion failure). CI must run the build
 *   before this suite. The path is hard-coded to the `hello-world` post, which
 *   therefore acts as a required canary fixture: renaming/deleting that post,
 *   or changing Astro's output path (e.g. `build.format`), breaks this test.
 *
 * SECURITY / RLS NOTE
 *   None. This test reads a public, already-built static HTML file. It touches
 *   no secrets, no Supabase/RLS surface, no tokens, and no paywall/entitlement
 *   logic — it is a pure output-shape assertion with no trust boundary.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Read the built page ONCE, eagerly, at module load. `process.cwd()` is the
// repo root under Vitest, so this resolves to the artifact Astro emitted for
// the canary post. WHY top-level: both tests share the same immutable output,
// so there's no need to re-read per test. TRADE-OFF: a missing `dist/` (build
// not run) throws here during collection rather than inside a test.
const html = readFileSync(
  join(process.cwd(), 'dist', 'blog', 'hello-world', 'index.html'),
  'utf-8'
);

describe('markdown rendering', () => {
  it('syntax-highlights fenced code with Shiki', () => {
    // Astro wraps Shiki output in <pre class="astro-code ...">. We assert on the
    // stable `astro-code` marker class rather than on specific token spans/colors,
    // which are theme-dependent and would make the test brittle. Presence of the
    // class proves the fenced code in hello-world.md went through Shiki at build.
    expect(html).toContain('astro-code');
  });

  it('shows an estimated reading time', () => {
    // Match the reading-time label the layout injects, e.g. "3 min read".
    // Regex (not an exact string) because the minute count is content-derived
    // and will drift as the post is edited — we only care that SOME numeric
    // "N min read" estimate is rendered, proving the metric is wired up.
    expect(html).toMatch(/\d+ min read/);
  });
});
