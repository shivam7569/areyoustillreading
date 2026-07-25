/**
 * comments.test.ts — Build-output smoke test for the blog comments widget.
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE IS
 *   A single Vitest suite that asserts the statically-generated HTML for a
 *   canonical blog post ("hello-world") ships with a comments section that is
 *   correctly wired to that post's identifier. It is a *post-build* contract
 *   test: it reads the compiled artifact from `dist/`, NOT source `.astro`
 *   files, so it verifies what the browser will actually receive.
 *
 * SINGLE RESPONSIBILITY
 *   Prove that (a) a "Comments" UI region is present in the rendered page and
 *   (b) the comments container is stamped with the correct `data-post-id`. The
 *   `data-post-id` attribute is the join key the client-side comments script
 *   uses to scope reads/writes to one post's thread. If that attribute is
 *   missing or wrong, the browser would fetch/insert comments against the wrong
 *   (or no) post — hence this guards the wiring, not the comment CRUD itself.
 *
 * HOW IT FITS THE ARCHITECTURE
 *   Comments are a Cloudflare Pages backend feature: the browser's Supabase JS
 *   client reads/writes a `comments` table gated by Postgres Row-Level Security
 *   (per-post, per-user), with Turnstile guarding submissions against bots. The
 *   static Astro page only needs to render the mount point and hand the client
 *   the post id via `data-post-id`; everything security-sensitive (who may read,
 *   who may insert, spam checks) lives server-side in RLS + Pages Functions.
 *   This test therefore only asserts the presence of the wiring, and correctly
 *   makes NO security claim — none can be verified from static HTML.
 *
 * DEPENDS ON (imports / preconditions)
 *   - `vitest` — describe/it/expect test runner.
 *   - `node:fs` readFileSync + `node:path` join — read the compiled artifact.
 *   - PRECONDITION: `astro build` (via `npm run build`) has already produced
 *     `dist/blog/hello-world/index.html`. This test does not build; if the
 *     `dist/` file is stale or absent, `readFileSync` throws at import/collection
 *     time and the suite errors out (a deliberate fail-loud, not a false pass).
 *   - Implicitly depends on the `hello-world` post existing in the content
 *     collection and on the layout/component that renders the comments mount.
 *
 * DEPENDED ON BY
 *   - The Vitest run (CI / `npm test`). Nothing imports this module.
 *
 * GOTCHAS
 *   - Reads from `dist/`, so it MUST run after a build; running it against a
 *     stale build tests stale output.
 *   - The `hello-world` slug and its expected `data-post-id` are hardcoded to a
 *     known fixture post; renaming/removing that post breaks this test by design.
 *   - Assertions are substring checks (`toContain`), so they are tolerant of
 *     surrounding markup changes but will break if the literal "Comments" label
 *     or the `data-post-id="hello-world"` attribute spelling changes.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Read the compiled page for the fixture post from the build output.
// WHY dist/ (not the source .astro): we want to assert on the exact HTML the
// browser receives after Astro's compile + render, catching regressions in the
// component wiring that source inspection could miss. process.cwd() anchors the
// path to the repo root where Vitest is invoked; join keeps it OS-portable.
// If the file is missing (no prior build), this throws immediately — fail loud
// rather than silently pass on absent output.
const html = readFileSync(
  join(process.cwd(), 'dist', 'blog', 'hello-world', 'index.html'),
  'utf-8'
);

describe('comments', () => {
  it('renders a comments section wired to the post id', () => {
    // (1) The comments UI region is present at all — guards against the
    //     component being dropped from the layout entirely.
    expect(html).toContain('Comments');
    // (2) The mount point carries the correct post identifier. This is the
    //     load-bearing assertion: `data-post-id` is the key the client-side
    //     Supabase-backed comments script uses to scope the thread to THIS post
    //     (RLS + queries key off it). A wrong/missing id would silently attach
    //     comments to the wrong post, so we pin the exact expected value.
    expect(html).toContain('data-post-id="hello-world"');
  });
});
