/**
 * tests/katex.test.ts
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE IS
 *   A Vitest build-output ("post-build") smoke test that proves the KaTeX math
 *   rendering pipeline actually fired during `astro build`. It reads one known
 *   emitted HTML page from the `dist/` directory and asserts that LaTeX source
 *   in the Markdown was transformed into KaTeX HTML markup.
 *
 * SINGLE RESPONSIBILITY
 *   Guard exactly one invariant: math written in a blog post's Markdown is
 *   rendered to static KaTeX markup AT BUILD TIME (not left as raw `$...$`
 *   source and not deferred to a client-side script). It does not test KaTeX's
 *   own correctness, spacing, or accessibility — only that the remark-math ->
 *   rehype-katex stage ran and produced `.katex` output for this page.
 *
 * HOW IT FITS THE ARCHITECTURE
 *   The Markdown pipeline (see project context) uses remark-math to parse `$`
 *   math delimiters and rehype-katex to render them to HTML during the static
 *   build. Because this is a static Astro site deployed to Cloudflare Pages via
 *   Wrangler direct upload, the rendered `dist/` is the actual shipped artifact.
 *   Asserting against the built HTML — rather than mocking the pipeline — is the
 *   most faithful check that visitors receive pre-rendered math with no runtime
 *   KaTeX dependency.
 *
 * IMPORTANT PRECONDITION / ORDERING GOTCHA
 *   This test reads a file from `dist/`, so it is meaningless unless `astro
 *   build` has already run and produced that file. Run the build BEFORE this
 *   test (e.g. `npm run build` then `vitest`). If `dist/blog/hello-world/
 *   index.html` is missing (build skipped, stale, cleaned, or the slug/route
 *   changed), `readFileSync` throws at module load — the failure will read as an
 *   ENOENT error, NOT a clean assertion failure. That is intentional: a missing
 *   artifact should be a hard, loud failure, not a silent pass.
 *
 * DEPENDS ON (inputs)
 *   - The `hello-world` blog post existing and containing at least one math
 *     expression (`$...$` / `$$...$$`). If that post's math is ever removed or
 *     the post is renamed, this test must be updated in lockstep — it is
 *     coupled to that specific slug and that post's content.
 *   - The remark-math / rehype-katex config in the Astro Markdown pipeline.
 *   - A completed `dist/` build (see precondition above).
 *
 * DEPENDED ON BY
 *   - The Vitest suite / CI gate. Nothing imports this file; it is a leaf test.
 *
 * SECURITY / RLS NOTE
 *   None. This is a pure static-output assertion — no network, no Supabase, no
 *   auth, no tokens, no entitlement gating. It only reads a local build file.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Read the built HTML for the `hello-world` post ONCE at module load (top-level,
// outside the test body). WHY here: the file content is a constant fixture for
// every assertion, so there's no need to re-read per test. Side effect: if the
// file is absent this throws immediately and the whole file fails to load —
// see the "IMPORTANT PRECONDITION" note above; this is the desired fail-fast.
//
// `process.cwd()` is the repo root when Vitest runs, so this resolves to the
// emitted artifact at dist/blog/hello-world/index.html. `join` keeps the path
// OS-correct (this project is developed on Windows).
const html = readFileSync(
  join(process.cwd(), 'dist', 'blog', 'hello-world', 'index.html'),
  'utf-8'
);

describe('KaTeX math', () => {
  it('renders math to KaTeX markup at build time', () => {
    // KaTeX wraps every rendered expression in an element with `class="katex"`.
    // Its presence is the tell-tale that rehype-katex ran at build time and the
    // math was NOT left as raw `$...$` source or punted to a client-side
    // renderer. `toContain` (substring match) is deliberately loose: we only
    // care that math rendering happened at all, not about exact KaTeX markup —
    // which would make the test brittle against KaTeX version bumps.
    expect(html).toContain('class="katex"');
  });
});
