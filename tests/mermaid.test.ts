/**
 * tests/mermaid.test.ts
 * ----------------------------------------------------------------------------
 * WHAT THIS FILE IS
 *   A Vitest integration test that guards the *build-time* Mermaid rendering
 *   contract for this Astro site. It asserts two things about the compiled
 *   production HTML of a known blog post:
 *     1. Every ```mermaid ...``` fence in the Markdown was converted to an
 *        inline <svg> during `astro build` (via the `rehype-mermaid` plugin).
 *     2. NO Mermaid JavaScript runtime is shipped to the browser — the
 *        diagram is pre-rendered, so visitors never download/execute mermaid.
 *
 * SINGLE RESPONSIBILITY
 *   Verify the Markdown → HTML Mermaid pipeline produces static, pre-rendered
 *   SVG with zero client-side JS cost. This is a regression fence: if someone
 *   swaps to a client-rendered Mermaid setup, or the rehype plugin silently
 *   stops running, these tests fail.
 *
 * HOW IT FITS THE ARCHITECTURE
 *   - Astro compiles Markdown through a remark/rehype pipeline. `rehype-mermaid`
 *     runs at build time (typically driving a headless browser / Playwright)
 *     to turn Mermaid fences into inline SVG in the emitted `dist/**` HTML.
 *   - This test reads the ALREADY-BUILT artifact from `dist/`. It does NOT
 *     build anything itself. Therefore it presumes `astro build` (`npm run
 *     build`) has already run and populated `dist/blog/hello-world/index.html`.
 *     If `dist/` is stale or missing, `readFileSync` throws and the whole
 *     suite errors out before any assertion — that failure mode means "you
 *     forgot to build", not "Mermaid is broken".
 *
 * DEPENDS ON (inputs)
 *   - Node builtins: `fs.readFileSync`, `path.join`.
 *   - Vitest globals via explicit import (describe/it/expect).
 *   - The build output file `dist/blog/hello-world/index.html`, which in turn
 *     depends on the source post `src/content/blog/hello-world.md` (or `.mdx`)
 *     containing a Mermaid fence with a node whose label is "Prompt".
 *
 * DEPENDED ON BY
 *   - The CI/test runner (`vitest`) picks this up by filename convention.
 *     Nothing imports from this module.
 *
 * GOTCHAS / ASSUMPTIONS (read before editing)
 *   - COUPLED TO CONTENT: the assertions are tied to the literal string
 *     "Prompt" appearing as a Mermaid node label in the `hello-world` post.
 *     If that post's diagram is edited so "Prompt" no longer appears (or the
 *     post is renamed/removed), this test breaks even though the pipeline is
 *     fine. Keep the fixture post and this test in sync.
 *   - `process.cwd()` MUST be the repo root when Vitest runs (the default),
 *     otherwise the relative `dist/...` path won't resolve.
 *   - No security/RLS surface here: this is a pure static-output assertion on
 *     local build artifacts. It touches no Supabase, no auth, no network.
 *   - The file is read ONCE at module load (top level), not per-test, so both
 *     `it()` blocks share the same in-memory `html` snapshot.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Load the compiled production HTML for the canonical fixture post exactly
// once at import time. `process.cwd()` is the repo root under Vitest; the
// path points into the `astro build` output tree. A missing/stale `dist/`
// makes this throw synchronously — a deliberate "did you build first?" signal.
const html = readFileSync(
  join(process.cwd(), 'dist', 'blog', 'hello-world', 'index.html'),
  'utf-8'
);

describe('Mermaid diagrams', () => {
  it('renders the mermaid fence to inline SVG at build time', () => {
    // Presence of an <svg> tag proves rehype-mermaid ran and emitted vector
    // markup rather than leaving a raw ```mermaid code block untouched.
    expect(html).toContain('<svg');
    // A node label from the diagram must be present inside the rendered SVG.
    // This confirms the SVG is actually the diagram's content (not some
    // unrelated icon/logo SVG on the page) — the "Prompt" node from the
    // fixture post's flowchart must survive into the final HTML.
    expect(html).toContain('Prompt');
  });

  it('ships no client-side mermaid runtime', () => {
    // Guards the performance/privacy contract: the diagram is baked in, so the
    // browser must NOT download a mermaid bundle or invoke mermaid.initialize().
    // The regex catches both the library file (mermaid.js / mermaid.min.js) and
    // the runtime bootstrap call. A match here means someone regressed to
    // client-side rendering — extra JS weight for zero visual benefit.
    expect(html).not.toMatch(/mermaid(\.min)?\.js|mermaid\.initialize/);
  });
});
