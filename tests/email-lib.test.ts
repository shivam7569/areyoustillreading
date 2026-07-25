/**
 * tests/email-lib.test.ts — Unit tests for the PURE, side-effect-free helpers
 * exported by `lib/email.js`.
 *
 * WHAT THIS FILE IS
 * -----------------
 * A Vitest suite that pins down the input-validation and canonicalization
 * primitives that guard the newsletter double opt-in flow: `isValidEmail`,
 * `normalizeEmail`, and `isUuid`. These three functions are the ONLY exports of
 * `lib/email.js` that can be tested in isolation — everything else in that module
 * (`verifyTurnstile`, the PostgREST data-access helpers, `sendConfirmationEmail`)
 * performs network I/O against Cloudflare Turnstile, Supabase, or Resend and
 * therefore needs a live env binding + mocking, which is deliberately OUT OF
 * SCOPE here. This file locks the cheap-but-security-relevant logic.
 *
 * WHY THESE THREE MATTER (SECURITY CONTEXT)
 * -----------------------------------------
 * All three are first-line gatekeepers on untrusted, browser-supplied input, so
 * a regression here weakens the server-side boundary described in lib/email.js:
 *   - isValidEmail  → rejects malformed addresses before a Supabase round-trip
 *                     and a Resend send are spent on them.
 *   - normalizeEmail→ canonicalizes (trim + lowercase) so the UNIQUE(email)
 *                     constraint can't be defeated by casing/whitespace, which
 *                     would let one human create duplicate subscriber rows.
 *   - isUuid        → shape-checks caller-supplied row ids before they are
 *                     spliced into a PostgREST `eq.` filter (defense-in-depth
 *                     against filter/query injection, alongside encodeURIComponent).
 * Because lib/email.js runs with the Supabase SERVICE-ROLE key (which BYPASSES
 * Row-Level Security), the database will not second-guess bad input — so these
 * validators carry real weight and are worth pinning with tests.
 *
 * HOW IT FITS / DEPENDS
 * ---------------------
 *   - Runner: Vitest (`describe`/`it`/`expect`). Run via the repo's test script.
 *   - System under test: ../lib/email.js — a plain, dependency-free JS module
 *     shared by the functions/api/* Cloudflare Pages Functions.
 *   - Nothing depends on THIS file; it is a leaf in the graph (a test).
 *
 * GOTCHA: the import below is a `.js` module with NO TypeScript declarations, so
 * the `@ts-expect-error` is REQUIRED to satisfy the type-checker. If lib/email.js
 * ever gains a `.d.ts` (or is ported to .ts), this directive will itself become
 * an unused-directive error and must be removed — that is the intended signal.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error - plain JS shared module (no type declarations)
import { isValidEmail, normalizeEmail, isUuid } from '../lib/email.js';

describe('email lib (pure logic)', () => {
  it('validates email addresses', () => {
    // Happy paths: a minimal valid address, and one exercising the "exotic but
    // legal" shape (dot + "+" tag in local part, multi-label subdomain) that the
    // deliberately-loose regex must NOT reject — over-strict validation would
    // block real users, and double opt-in proves true deliverability anyway.
    expect(isValidEmail('a@b.co')).toBe(true);
    expect(isValidEmail('x.y+z@sub.domain.io')).toBe(true);
    // Rejections, each pinning a specific failure mode of the regex/guards:
    expect(isValidEmail('nope')).toBe(false);      // no "@" at all
    expect(isValidEmail('a@b')).toBe(false);       // domain has no dot → not routable
    expect(isValidEmail('a b@c.co')).toBe(false);  // whitespace in address (the [^\s@] guard)
    expect(isValidEmail('')).toBe(false);          // empty string
    // Non-string input must be safely rejected, NOT throw — callers pass raw,
    // unparsed JSON values straight in, so `null` (and friends) must return false.
    expect(isValidEmail(null)).toBe(false);
  });

  it('normalizes emails (trim + lowercase)', () => {
    // Single assertion deliberately combines BOTH transforms: surrounding
    // whitespace is trimmed AND the address is lowercased. This is the exact
    // property the UNIQUE(email) de-duplication relies on — "  A@B.CO " and
    // "a@b.co" must collapse to one canonical key.
    expect(normalizeEmail('  A@B.CO ')).toBe('a@b.co');
  });

  it('validates UUID tokens', () => {
    // A canonical RFC-4122 UUID must pass (this is the shape of a `subscribers.id`).
    expect(isUuid('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
    // Anything not matching the strict 8-4-4-4-12 hex pattern must fail before it
    // could ever reach a PostgREST filter — a hostile id is rejected in-process.
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid('')).toBe(false);
    // Non-string input (null) must return false, never throw — same untrusted-input
    // contract as isValidEmail above.
    expect(isUuid(null)).toBe(false);
  });
});
