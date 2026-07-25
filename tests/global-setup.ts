/**
 * tests/global-setup.ts — Vitest global setup hook.
 *
 * WHAT THIS IS
 * ------------
 * A single-purpose Vitest "globalSetup" module. Vitest imports this file once,
 * before ANY test file runs, and invokes its default export exactly one time for
 * the whole run (not per-file, not per-test). Its sole job is to produce a fresh
 * production build so the test suite has a real `dist/` to assert against.
 *
 * SINGLE RESPONSIBILITY
 * ---------------------
 * Run `npm run build` once, synchronously, before the suite. Nothing else — no
 * fixtures, no DB seeding, no server boot. If the build fails, the whole test run
 * fails fast (see WHY below).
 *
 * HOW IT FITS THE ARCHITECTURE
 * ----------------------------
 * This is a *static* Astro site: the meaningful output is the emitted `dist/`
 * directory (HTML, OG images, Pagefind index, RSS/sitemap, KaTeX/Shiki/Mermaid
 * markup baked at build time, etc.). Most of the project's runtime behavior is
 * therefore decided at BUILD time, not request time. Consequently the tests are
 * written to inspect the built artifacts rather than to spin up a live server.
 * `npm run build` is defined as the Astro build (which also triggers the
 * build-time steps: Pagefind indexing, astro-og-canvas OG generation, Mermaid
 * pre-rendering via rehype-mermaid, sitemap/RSS emission). A green build is thus
 * itself the first assertion — a broken pipeline can never reach the individual
 * `*.test.ts` files because this hook throws first.
 *
 * NOTE: this covers only the STATIC build surface. The backend features
 * (Cloudflare Pages Functions, Supabase/PostgREST + RLS, Resend, Turnstile,
 * Dodo Payments webhooks) are not exercised here — no functions runtime is
 * booted and no secrets are consumed, so nothing security-sensitive runs during
 * setup. Any RLS/entitlement/signature-verification testing lives in the
 * individual test files (or is exercised against the deployed environment), not
 * in this hook.
 *
 * DEPENDENCIES (imports)
 * ----------------------
 *   - node:child_process `execSync` — the only import. Chosen because setup must
 *     be strictly synchronous and blocking: Vitest waits for the default export
 *     to resolve/return before starting any worker, and we want the build fully
 *     finished (dist/ on disk) before the first test reads it.
 *   - Implicitly depends on: a `build` script existing in package.json, and the
 *     local toolchain (Astro + Pagefind) being installed.
 *
 * WHAT DEPENDS ON THIS
 * --------------------
 *   - The Vitest config (vitest.config.* — its `test.globalSetup` field must
 *     point at this file, otherwise this code never runs).
 *   - Every `*.test.ts` that reads from `dist/` implicitly depends on this hook
 *     having populated `dist/` first.
 *
 * GOTCHAS / ASSUMPTIONS
 * ---------------------
 *   - This does a FULL build on every `vitest` invocation, so the suite is slow
 *     to start; that is the deliberate trade for testing the real emitted output.
 *   - `dist/` is not cleaned here. We rely on `astro build` to overwrite/emit a
 *     coherent output; stale files from a prior run are Astro's concern, not this
 *     hook's.
 *   - No optional teardown is exported. Vitest allows returning a teardown
 *     function from setup; we intentionally don't, because there is no process or
 *     port to tear down — only files on disk.
 */
import { execSync } from 'node:child_process';

// Runs once before the whole Vitest suite. `npm run build` = astro build +
// pagefind index; a green build is itself the first gate, and the .test.ts
// files then assert on the emitted dist/ output.
export default function setup() {
  // `stdio: 'inherit'` pipes the child build's stdout/stderr straight to this
  // process's terminal so the developer sees Astro/Pagefind progress and errors
  // live (rather than swallowed or buffered). WHY it matters for correctness:
  // execSync throws on any non-zero exit code, and because we neither catch nor
  // return that error, the throw propagates out of the globalSetup hook — Vitest
  // treats a throwing setup as a hard failure and aborts the entire run before a
  // single test executes. That is the intended fail-fast gate: no test should
  // ever run against a `dist/` that didn't build cleanly.
  execSync('npm run build', { stdio: 'inherit' });
}
