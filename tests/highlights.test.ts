/**
 * highlights.test.ts
 * =============================================================================
 * WHAT THIS FILE IS
 * -----------------------------------------------------------------------------
 * A Vitest smoke/build-output test that asserts the "Highlights + discussion"
 * feature is actually present in the statically-rendered HTML that ships to
 * Cloudflare Pages. It does NOT test runtime behaviour (saving a highlight,
 * auth, Supabase writes, RLS). Its single responsibility is: "did the Astro
 * build emit the highlights UI markup into the blog post page?"
 *
 * WHY IT WORKS THE WAY IT DOES
 * -----------------------------------------------------------------------------
 * This is a *static* Astro site (Astro 7 -> Cloudflare Pages via Wrangler
 * direct upload, `npm run deploy`). The highlights UI is server-rendered at
 * build time into each blog post's `index.html`. Rather than spin up a browser
 * or a dev server, this test reads the already-built HTML file straight off
 * disk and does substring assertions. That makes it a fast regression guard:
 * if someone deletes/renames the highlights component, changes the section
 * heading, or drops the save button's id, this test fails.
 *
 * HOW IT FITS THE ARCHITECTURE
 * -----------------------------------------------------------------------------
 * - The interactive save/entitlement/auth logic lives in client JS + Astro
 *   components + Cloudflare Pages Functions + Supabase (RLS-locked). NONE of
 *   that is exercised here — this only checks the presence of the static shell
 *   the client script hydrates onto (specifically the `#hl-save-btn` hook).
 * - Security note: because this test only inspects build output, it provides
 *   NO assurance about token checks, entitlement gating, or Row-Level Security.
 *   Those are covered by the leak-protection / gating tests elsewhere. Do not
 *   read a passing run here as "highlights are secure" — only as "the markup
 *   rendered".
 *
 * DEPENDENCIES / PRECONDITIONS (IMPORTANT GOTCHA)
 * -----------------------------------------------------------------------------
 * - Reads from `dist/`, so the Astro build MUST have run first. If `dist/` is
 *   stale or missing, `readFileSync` throws at module load and the whole suite
 *   errors before any `it()` runs. CI ordering (build -> test) is load-bearing.
 * - Hard-codes the `hello-world` blog slug as a representative post. If that
 *   post is renamed or removed, this test breaks even though the feature is
 *   fine — it's a canary tied to one known-good page, not a per-post scan.
 * - Path is built from `process.cwd()`, so the test must be run from the repo
 *   root (Vitest's default), not from inside `tests/`.
 *
 * WHAT DEPENDS ON THIS FILE
 * -----------------------------------------------------------------------------
 * Nothing imports it; Vitest discovers and runs it. It is a leaf regression
 * check in the test suite.
 * =============================================================================
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Read the built blog post HTML ONCE at module load (module-level const), so
// both the file read and any missing-`dist/` failure happen up front rather
// than per-test. `process.cwd()` = repo root under Vitest; the `hello-world`
// slug is the canonical fixture post we assert against. `utf-8` returns a
// string so we can do plain substring matching below.
const html = readFileSync(
  join(process.cwd(), 'dist', 'blog', 'hello-world', 'index.html'),
  'utf-8'
);

describe('highlights', () => {
  it('renders the highlights + discussion section and save button', () => {
    // Assert the human-visible section heading made it into the static HTML.
    // Guards against the highlights/discussion component being removed or its
    // heading text changing.
    expect(html).toContain('Highlights');
    // Assert the save button's stable id is present. This id is the hydration
    // hook the client-side script binds its click handler to — if it's missing
    // or renamed, the "save highlight" interaction silently breaks at runtime,
    // so we pin it here as a contract between markup and client JS.
    expect(html).toContain('id="hl-save-btn"');
  });
});
