/**
 * tests/og.test.ts — Post-build smoke test for the Open Graph (OG) image pipeline.
 *
 * WHAT THIS FILE IS
 *   A Vitest suite that asserts the static build (the `dist/` directory) actually
 *   emitted a per-post OG social-preview image AND wired it into the post's HTML
 *   `<head>`. OG images are the thumbnails link previews render when a post URL is
 *   shared on social/chat platforms (Twitter/X, Slack, Discord, iMessage, etc.).
 *
 * SINGLE RESPONSIBILITY
 *   Verify the OUTPUT ARTIFACTS of the OG image generation step — not the generator's
 *   internals. It is a black-box check against files on disk: (1) the PNG exists and
 *   is non-trivially sized, (2) the rendered post page points at that PNG.
 *
 * HOW IT FITS THE ARCHITECTURE
 *   The project uses `astro-og-canvas` to render an OG PNG for every blog post at
 *   BUILD TIME. Those images land under `dist/og/<slug>.png`, and each post layout
 *   injects an `<meta property="og:image">` (and/or twitter:image) tag referencing
 *   `/og/<slug>.png`. This test is the regression guard: if the OG integration
 *   breaks, is misconfigured, or a slug/path convention changes, the build might
 *   still "succeed" while silently shipping posts with no social preview. Catching
 *   that here is cheaper than discovering it after a link is shared publicly.
 *
 * DEPENDS ON (upstream — must run FIRST or every assertion fails)
 *   - A completed production build. This suite reads real files from `dist/`; it does
 *     NOT build anything itself. Run `npm run build` (astro build) before `vitest`,
 *     otherwise `dist/` is absent/stale and these tests fail as a false negative.
 *   - The astro-og-canvas OG generation step and the post layout's head markup.
 *   - The fixture post with slug `hello-world` existing and being published (a draft
 *     or renamed slug would break both assertions — see GOTCHA below).
 *
 * DEPENDED ON BY
 *   - Nothing imports this file; Vitest discovers and runs it directly. It is a leaf
 *     in the test graph.
 *
 * SECURITY / RLS NOTES
 *   - None. This is a pure filesystem/static-output check. It touches no network, no
 *     Supabase/PostgREST, no auth tokens, no Row-Level Security, no payments, and no
 *     secrets. Nothing here is security-sensitive; there is no token/signature/
 *     entitlement/honeypot logic to reason about.
 *
 * GOTCHAS
 *   - Hard-coded fixture slug `hello-world`. If that post is renamed, unpublished, or
 *     removed, this suite fails even though the OG pipeline is healthy. It is a
 *     canary tied to a specific known-good post, not a scan of all posts.
 *   - The `> 1000` byte floor is a heuristic "this is a real PNG, not an empty/errored
 *     stub" guard, not an exact-size assertion — it deliberately tolerates future
 *     design tweaks that change the rendered image's byte size.
 *   - `process.cwd()` assumes Vitest runs from the repo root (its normal invocation).
 *     Running from another directory would resolve `dist/` to the wrong place.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Absolute path to the build output directory. Resolved from the process working
// directory (repo root under normal `npm test` invocation), NOT from this file's
// location — see the process.cwd() gotcha above.
const dist = join(process.cwd(), 'dist');

describe('dynamic OG images', () => {
  it('generates a PNG for each post', () => {
    // The OG generator names images by post slug and drops them under dist/og/.
    // `hello-world` is our known-good fixture post that must always produce one.
    const p = join(dist, 'og', 'hello-world.png');
    // Existence check: catches the OG integration being disabled/misconfigured, or
    // the output path convention drifting away from dist/og/<slug>.png.
    expect(existsSync(p)).toBe(true);
    // Size floor: a real rendered PNG is comfortably >1KB. A 0-byte or truncated
    // stub (e.g. the renderer erroring but still touching the file) would pass an
    // existsSync check yet fail here — this asserts the image has actual content.
    expect(statSync(p).size).toBeGreaterThan(1000);
  });

  it('references its OG image from the post head', () => {
    // Read the fully-rendered post page from the build output. The trailing-slash
    // route convention emits each post as blog/<slug>/index.html.
    const html = readFileSync(join(dist, 'blog', 'hello-world', 'index.html'), 'utf-8');
    // The layout must emit a head tag (og:image / twitter:image) pointing at the
    // generated PNG. Substring match keeps this robust to attribute ordering and
    // absolute-vs-relative URL prefixes while still proving the link is present:
    // an image that exists on disk but is never referenced would render no preview.
    expect(html).toContain('/og/hello-world.png');
  });
});
