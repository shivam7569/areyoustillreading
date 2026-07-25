/**
 * =============================================================================
 * tests/paywall.test.ts — Paywall leak-protection regression suite
 * =============================================================================
 *
 * WHAT THIS FILE IS
 * -----------------
 * A Vitest suite that guards the single most important security invariant of the
 * per-post paywall: **the gated (paid) body of a premium post must never be
 * shipped to any public, unauthenticated surface of the static build.** It is
 * the last line of defense against the classic static-site paywall failure mode
 * where the "protected" content is actually present in the HTML/feed and merely
 * hidden with CSS or a JS overlay — trivially scraped by viewing source.
 *
 * SINGLE RESPONSIBILITY
 * ---------------------
 * Assert, against the *already-built* `dist/` output, that a known secret
 * sentence from a premium post appears ONLY in the dedicated gated route and
 * nowhere a crawler, RSS reader, or casual "view source" visitor could reach it.
 * It does not test payment flows, entitlement middleware, or auth — only the
 * physical presence/absence of gated bytes in the emitted files.
 *
 * HOW IT FITS THE ARCHITECTURE
 * ----------------------------
 * This is a static Astro build deployed to Cloudflare Pages. The paywall design
 * (see Phase 3 commits) splits every premium post into two rendered artifacts:
 *   - The PUBLIC post page (`/blog/<slug>/`) renders only a "preview"/teaser and
 *     a <PaywallGate> — the paid body is deliberately omitted from this HTML.
 *   - A separate GATED route (`/gated/<slug>/`) renders the FULL body. Access is
 *     enforced at request time by a Cloudflare Pages Function (token/entitlement
 *     middleware backed by Supabase RLS + Dodo Payments), NOT by this test.
 * Because the gated HTML physically exists in `dist/`, the real protection is
 * twofold: (1) the runtime Function must gate it, and (2) it must be kept out of
 * every crawlable index (listing page, RSS, sitemap) and marked no-index so it
 * is never surfaced or cached publicly. This suite verifies half (2) — the
 * build-time containment — which the runtime gate cannot retroactively fix once
 * bytes have leaked into a feed or the search index.
 *
 * DEPENDS ON (imports)
 * --------------------
 *   - `vitest` (describe/it/expect) — the test runner/assertions.
 *   - `node:fs` readFileSync + `node:path` join — synchronous reads of built
 *     files. No mocks: it inspects real emitted bytes on disk.
 *
 * DEPENDS ON (implicit, NOT imported — these are the real gotchas)
 * ---------------------------------------------------------------
 *   - A completed production build: `dist/` MUST already exist. This suite reads
 *     the build output directly; it does NOT trigger a build. Run `astro build`
 *     (e.g. `npm run build`) first or every `read()` throws ENOENT. In CI this
 *     must be ordered after the build step.
 *   - A fixture post `src/content/blog/premium-example.md` that is flagged
 *     gateable/preview and whose PAID body contains the exact secret sentence
 *     `GATED` below, while its preview contains the literal `free teaser`. If
 *     that fixture is renamed, deleted, or its wording changes, these tests go
 *     silently useless (see the false-negative gotcha under GATED).
 *
 * DEPENDED ON BY
 * --------------
 *   - The test/CI pipeline only. No application code imports this file.
 *
 * SECURITY ASSUMPTIONS / GOTCHAS
 * ------------------------------
 *   - substring containment is a coarse but deliberately strict signal: if the
 *     secret string appears ANYWHERE in a public file (even inside a JSON blob,
 *     a data-attribute, an inlined island prop, or an OG-image alt text) the
 *     test fails. That over-sensitivity is intentional — a leak is a leak.
 *   - Conversely, absence of THIS one sentence does not prove the whole body is
 *     safe; it is a canary. Keep the canary sentence long/unique enough that it
 *     cannot appear by coincidence, and keep it exclusively in the paid region.
 *   - This suite does NOT and CANNOT verify the runtime Pages Function actually
 *     blocks unauthenticated GETs to `/gated/...`; that is covered by the
 *     middleware/entitlement tests. Here we only ensure the gated route is
 *     no-indexed and excluded from crawlable indexes so its existence isn't
 *     advertised.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Root of the built site. `process.cwd()` is the repo root when Vitest runs, so
// this resolves to the same `dist/` that Wrangler uploads to Cloudflare Pages.
// Everything below is asserted against these real, shippable bytes.
const dist = join(process.cwd(), 'dist');
// Read a built file as UTF-8 text, relative to dist/. Intentionally sync + throwing:
// if a file is missing (e.g. build didn't run, or a route was renamed) we WANT a
// hard failure, not a passing test that silently checked nothing.
const read = (p: string) => readFileSync(join(dist, p), 'utf-8');

// The canary: a distinctive sentence that exists ONLY in the gated (paid) body of
// the fixture post premium-example.md. Its presence in any public surface is proof
// of a leak; its presence in the gated route is proof the paid body rendered.
// GOTCHA: if the fixture's wording drifts so this substring no longer appears in the
// paid body, the "leak" assertions still PASS (nothing to find) — a false sense of
// safety. The gated-route test on line ~ below is the tripwire that catches that
// drift: it REQUIRES this string to be present, so a stale canary fails loudly there.
const GATED = 'must never appear';

describe('paywall content protection', () => {
  // Core invariant #1: the PUBLIC post page is what crawlers, unpaid readers, and
  // "view source" see. It must contain the teaser but NOT a single byte of the paid
  // body. The positive `free teaser` assertion is a build-sanity guard: it proves we
  // actually rendered the premium post's public shell (preview + PaywallGate) rather
  // than, say, a 404 or an empty page that would make the `.not.toContain` pass vacuously.
  it('keeps the gated body OUT of the public post page (shows preview instead)', () => {
    const pub = read('blog/premium-example/index.html');
    expect(pub).not.toContain(GATED);
    expect(pub).toContain('free teaser'); // preview is public
  });

  // Core invariant #2: the full paid body is allowed to exist in the build, but ONLY
  // at the dedicated gated route (runtime-gated by the Pages Function). Two checks:
  //  - toContain(GATED): confirms the paid body actually rendered here (also the
  //    tripwire that catches a stale/renamed canary — see GATED note above).
  //  - data-pagefind-ignore: the marker that tells Pagefind to skip this page when
  //    building the client search index. Without it the paid body would be indexed
  //    and served back via site search — a leak the runtime gate can't prevent,
  //    since the index is a static public artifact.
  it('renders the full body ONLY in the gated route, marked no-index', () => {
    const gated = read('gated/premium-example/index.html');
    expect(gated).toContain(GATED);
    expect(gated).toContain('data-pagefind-ignore');
  });

  // Core invariant #3: the three "broadcast" surfaces that syndicate content widely
  // must not carry the paid body or even advertise the gated route:
  //  - blog/index.html — the listing page (aggregates post content/excerpts).
  //  - rss.xml — the feed; RSS readers cache and redistribute, so a leak here is
  //    effectively permanent and uncontrollable.
  //  - sitemap-0.xml — checked differently ON PURPOSE: we assert the whole
  //    `/gated/` PATH is absent, not just the secret. Sitemaps list URLs, not body
  //    text, so the risk is discovery — telling crawlers the gated route exists.
  //    Keeping the path out prevents search engines from crawling/indexing it at all.
  it('does not leak the gated body into the blog listing, RSS, or sitemap', () => {
    expect(read('blog/index.html')).not.toContain(GATED);
    expect(read('rss.xml')).not.toContain(GATED);
    expect(read('sitemap-0.xml')).not.toContain('/gated/');
  });
});
