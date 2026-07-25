/**
 * tests/subscribe-pages.test.ts
 * =============================================================================
 * WHAT THIS FILE IS
 *   A Vitest suite that guards the newsletter-subscription *user interface* by
 *   asserting against the site's already-compiled static output in `dist/`.
 *   It is a build-artifact / smoke test, NOT a unit or integration test: it does
 *   not import any application source module, does not render Astro components in
 *   memory, and does not hit the network, Supabase, Resend, or Dodo Payments.
 *   It simply reads the HTML files that `astro build` emitted and checks that the
 *   subscribe form and the four subscribe "result" pages are present and wired up.
 *
 * SINGLE RESPONSIBILITY
 *   Verify that the subscription flow's static surface survived the build:
 *     1. The homepage still ships a subscribe <form> that POSTs to the correct
 *        server endpoint with the correct field name.
 *     2. All four terminal/result pages of the subscribe flow were generated.
 *   That is the entire contract. Anything about *behavior* (whether the endpoint
 *   actually stores an email, sends a magic link, validates Turnstile, etc.) is
 *   out of scope and lives in other tests / the Pages Functions themselves.
 *
 * HOW IT FITS THE ARCHITECTURE
 *   The project is a static Astro site deployed to Cloudflare Pages. The subscribe
 *   form is rendered at build time into `dist/index.html`; its `action` points at
 *   `/api/subscribe`, a Cloudflare Pages Function (server-side) that talks to
 *   Supabase (subscriber row) and Resend (double opt-in email). After the function
 *   runs it redirects the browser to one of four pre-built static outcome pages:
 *     - check-inbox      -> "we emailed you a confirmation link"
 *     - subscribed       -> confirmation link clicked, opt-in complete
 *     - unsubscribed     -> unsubscribe link honored
 *     - subscribe-error  -> generic failure fallback
 *   Because those pages are plain static HTML (no data, no auth), this test only
 *   needs to confirm the build produced them; their correctness is visual/content,
 *   not logic.
 *
 * WHY ASSERT AGAINST dist/ INSTEAD OF SOURCE
 *   The `action` URL and the `name="email"` field are the exact contract the
 *   server function depends on. A refactor of the .astro source (renaming the
 *   field, changing the endpoint, or accidentally dropping the form) would compile
 *   fine but silently break subscriptions in production. Checking the *emitted*
 *   HTML catches that class of regression at the artifact level — the same bytes
 *   the browser will receive.
 *
 * DEPENDENCIES / IMPORTS
 *   - vitest (describe/it/expect): the test runner.
 *   - node:fs (readFileSync, existsSync) + node:path (join): to read `dist/`.
 *   No project source is imported, by design.
 *
 * WHAT DEPENDS ON THIS FILE
 *   Nothing imports it. It is collected and run by Vitest (e.g. `npm test`) in CI
 *   / locally. It is one node in the test suite; no other module references it.
 *
 * PRECONDITION / GOTCHA (READ THIS IN 2 YEARS BEFORE DEBUGGING A FAILURE)
 *   This suite reads `dist/` relative to `process.cwd()`. It therefore REQUIRES a
 *   fresh `astro build` to have run first, and requires the test to be invoked
 *   from the repo root. If `dist/` is stale or missing you'll get either a false
 *   pass (against old HTML) or a hard readFileSync/ENOENT throw on `index.html`
 *   — NOT a clean assertion failure. If this test breaks, first confirm the build
 *   ran and cwd is the project root before suspecting the form itself.
 *
 * SECURITY / RLS NOTE
 *   There is no security-sensitive logic here — no tokens, entitlements, signature
 *   checks, or honeypot assertions. The subscribe *endpoint* and its Supabase
 *   Row-Level Security are what protect real data; this file only checks that the
 *   public, unauthenticated form markup exists. Keep it that way: do not add
 *   secrets or auth assumptions to a test that reads world-readable static output.
 * =============================================================================
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Root of the compiled site. Resolved from cwd (the repo root when tests run),
// NOT from this file's location — see the "PRECONDITION" note above.
const dist = join(process.cwd(), 'dist');
// Small readers scoped to dist/ so each assertion stays a one-liner.
// `read` returns file contents as a UTF-8 string; it THROWS if the file is
// absent (intentional — a missing index.html should fail loudly, not silently).
const read = (p: string) => readFileSync(join(dist, p), 'utf-8');
// `exists` is the non-throwing counterpart, used where we only care that the
// build emitted a file, not its contents.
const exists = (p: string) => existsSync(join(dist, p));

describe('subscribe UI', () => {
  it('renders the subscribe form on the homepage', () => {
    const html = read('index.html');
    // Contract check 1: the form still targets the Pages Function endpoint.
    // If the endpoint path drifts, submissions 404 and no one gets subscribed.
    expect(html).toContain('action="/api/subscribe"');
    // Contract check 2: the email field keeps the exact name the server reads.
    // Renaming this input (e.g. to "email_address") would make the function see
    // an empty email — a regression that compiles cleanly but breaks in prod.
    expect(html).toContain('name="email"');
  });

  it('builds all subscribe result pages', () => {
    // Every terminal page of the double-opt-in flow must be generated, because
    // the /api/subscribe function redirects to these static URLs. A missing page
    // would send a real subscriber to a 404 at the most important moment
    // (e.g. right after clicking their confirmation link).
    // Astro emits each route as `<route>/index.html` (directory-style URLs).
    for (const p of ['check-inbox', 'subscribed', 'unsubscribed', 'subscribe-error']) {
      expect(exists(`${p}/index.html`)).toBe(true);
    }
  });
});
