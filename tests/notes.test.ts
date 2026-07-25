/**
 * tests/notes.test.ts
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE IS
 *   A Vitest suite that asserts the "private notes" feature is present in the
 *   BUILT (static) HTML of a blog post. The private-notes feature is a small
 *   per-reader note editor that gets embedded on every post page; this test is
 *   the build-output smoke check that guards against the editor silently
 *   disappearing from the page (e.g. a template regression, a removed include,
 *   or a broken Astro component import).
 *
 * SINGLE RESPONSIBILITY
 *   Verify that the private-note editor markup is rendered into the compiled
 *   post page. Nothing more — it does NOT test note persistence, Supabase
 *   round-trips, RLS, or auth. It is purely a presence/HTML-shape check.
 *
 * HOW IT FITS THE ARCHITECTURE
 *   - This is a static Astro site: `npm run build` emits pre-rendered HTML into
 *     `dist/`. The private-note editor is authored in Astro (a component/partial
 *     included by the blog post layout) and therefore appears verbatim in the
 *     built HTML.
 *   - Because the markup is static, we can assert on it by reading the file off
 *     disk — no browser, no DOM, no dev server needed. The actual note
 *     save/load happens client-side at runtime against Supabase (PostgREST,
 *     locked by Row-Level Security so a reader can only see their own notes),
 *     but that runtime behavior is OUT OF SCOPE here.
 *
 * DEPENDS ON (imports / preconditions)
 *   - vitest: `describe`/`it`/`expect` test primitives.
 *   - node:fs `readFileSync` + node:path `join`: to load the build artifact.
 *   - PRECONDITION / GOTCHA: the site MUST already be built before this test
 *     runs. This reads `dist/blog/hello-world/index.html`, which only exists
 *     AFTER `astro build`. Run against a stale/missing `dist/` and the
 *     `readFileSync` at module load throws ENOENT before any test executes,
 *     failing the whole file. The CI/test pipeline is responsible for building
 *     first (build → test), not this file.
 *   - COUPLING GOTCHA: hard-codes the `hello-world` slug as the canonical
 *     fixture post. If that seed/sample post is renamed or removed, update the
 *     path here too — the test is intentionally pinned to one known post rather
 *     than globbing, to keep the assertion cheap and deterministic.
 *
 * DEPENDED ON BY
 *   - Nothing imports this file; it is a leaf test module discovered and run by
 *     the Vitest runner.
 *
 * SECURITY NOTE
 *   - No secrets, tokens, or auth here. The read is confined to the local
 *     `dist/` build output. This test asserts only that the editor UI is
 *     present; the security of notes themselves (a reader seeing only their own
 *     note) is enforced elsewhere by Supabase RLS at runtime, not by markup.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Load the compiled post page once at module-evaluation time (not per-test).
// - `process.cwd()` is the repo root when Vitest runs, so this resolves to the
//   real build artifact for the canonical `hello-world` post.
// - Read synchronously and eagerly: if `dist/` isn't built yet this throws here
//   and fails fast with a clear ENOENT, which is the intended fail-safe signal
//   that "you forgot to build before testing" rather than a confusing empty
//   assertion later.
const html = readFileSync(
  join(process.cwd(), 'dist', 'blog', 'hello-world', 'index.html'),
  'utf-8'
);

describe('private notes', () => {
  it('renders the private note editor on posts', () => {
    // Two independent substring checks act as a lightweight structural probe:
    //   1. The human-visible label proves the editor's UI copy shipped.
    //   2. The `id="note-body"` textarea is the DOM hook the client-side note
    //      script binds to for load/save; asserting on the id guards the exact
    //      contract the runtime JS depends on (a renamed id would break saving
    //      without any visual clue, so we pin the id, not just the label).
    // Substring (not DOM parse) is deliberate: cheap, dependency-free, and
    // sufficient for a "did the editor make it into the build?" smoke test.
    expect(html).toContain('Your private note');
    expect(html).toContain('id="note-body"');
  });
});
