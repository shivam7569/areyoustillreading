/**
 * tests/auth.test.ts
 * =============================================================================
 * WHAT THIS FILE IS
 * -----------------------------------------------------------------------------
 * A Vitest suite of build-output ("smoke") tests for the authentication UI of
 * areyoustillreading.dev. It does NOT test runtime auth behaviour (no browser,
 * no Supabase session, no network). Instead it asserts that the Astro static
 * build produced the expected auth-related pages and that they contain the
 * markers that prove both sign-in methods and the account entry point were
 * rendered into the shipped HTML.
 *
 * SINGLE RESPONSIBILITY
 * -----------------------------------------------------------------------------
 * Guard the *presence and shape of the built auth pages* in `dist/`. If a
 * refactor, a broken import, a mis-set Astro route, or an accidentally removed
 * template ever drops the login form, the GitHub OAuth button, the /account
 * page, or the nav link, one of these assertions fails fast — before deploy —
 * rather than surfacing as a broken auth flow in production.
 *
 * HOW IT FITS THE ARCHITECTURE
 * -----------------------------------------------------------------------------
 * The site is Astro 7 built to static HTML and uploaded to Cloudflare Pages via
 * Wrangler (`npm run deploy`). Auth itself is Supabase (email magic-link +
 * GitHub OAuth) driven client-side by the Supabase JS client; these pages are
 * the *shells* that host that client-side flow. This suite runs against the
 * already-built `dist/` directory, so it validates the deploy artifact — the
 * exact bytes that go to Cloudflare — not the source `.astro` files.
 *
 * DEPENDENCIES / WHAT IT IMPORTS
 * -----------------------------------------------------------------------------
 *   - vitest .......... test runner (describe/it/expect).
 *   - node:fs ......... synchronous file reads + existence checks against dist/.
 *   - node:path ....... cross-platform path joining (matters on Windows here).
 *
 * WHAT DEPENDS ON IT
 * -----------------------------------------------------------------------------
 *   - Nothing imports this file. It is discovered and executed by the Vitest
 *     runner (typically `npm test` / CI). Its implicit dependency is a PRIOR
 *     `astro build` having populated `dist/` — see GOTCHA below.
 *
 * SECURITY NOTE / SCOPE LIMITATION
 * -----------------------------------------------------------------------------
 * These are structural presence checks only. They deliberately assert nothing
 * about token validation, RLS enforcement, entitlement gating, or session
 * security — all of that lives server-side (Supabase RLS, the `is_admin()` SQL
 * function, Pages Functions) and is out of scope here. Do NOT read a passing
 * run as evidence the auth flow is secure; it only proves the UI shipped.
 *
 * GOTCHA
 * -----------------------------------------------------------------------------
 * This suite reads from `dist/`, which only exists AFTER a build. Run against a
 * stale or missing `dist/`, `read()` / `existsSync()` will throw or return
 * false and every test fails for reasons unrelated to the code under test.
 * The build must precede the test run (build step in CI / `npm run build`).
 * =============================================================================
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Absolute path to the Astro build output. `process.cwd()` is the repo root
// when Vitest is invoked via npm scripts; `join` keeps this correct on Windows
// (backslash separators) as well as POSIX CI runners.
const dist = join(process.cwd(), 'dist');

// Convenience reader: resolve a dist-relative path and return its UTF-8 text.
// Intentionally throws if the file is absent — a missing built page is itself a
// test failure we want surfaced loudly (see GOTCHA about running post-build).
const read = (p: string) => readFileSync(join(dist, p), 'utf-8');

describe('auth pages', () => {
  it('builds the login page with both sign-in methods', () => {
    // Astro emits pretty-URL routes as `<route>/index.html`, so /login lives at
    // login/index.html. We assert BOTH auth paths rendered into one page:
    const html = read('login/index.html');
    // `name="email"` proves the magic-link email input exists (the Supabase
    // email OTP / magic-link entry point).
    expect(html).toContain('name="email"');
    // "GitHub" proves the OAuth button rendered — the second sign-in method.
    // A loose text match is deliberate: it survives styling/markup changes while
    // still catching an accidentally dropped OAuth option.
    expect(html).toContain('GitHub');
  });

  it('builds the account page', () => {
    // The authenticated landing page must exist as a built route. We only check
    // existence (not contents) because its dynamic, session-gated body is
    // populated client-side by the Supabase client at runtime — there is no
    // meaningful static marker to assert on here.
    expect(existsSync(join(dist, 'account', 'index.html'))).toBe(true);
  });

  it('links Account in the nav', () => {
    // Regression guard for the global nav: the home page must link to /account
    // so signed-in users can reach their account. Catches a nav/layout refactor
    // that silently drops the entry point even when the page itself still builds.
    expect(read('index.html')).toContain('href="/account"');
  });
});
