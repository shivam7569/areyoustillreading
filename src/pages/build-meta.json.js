/**
 * GET /build-meta.json — a static, per-deployment build stamp.
 *
 * Emitted ONCE at build time (this GET runs during `astro build`, so Date.now() is
 * the build's timestamp). The /blog/<slug> overlay reads `builtAt` to decide whether
 * a KV-published post is newer than THIS deployment — if so it serves the instant KV
 * copy; if the deployment is newer (the git-commit rebuild has landed with the post
 * baked in), it serves the fresh static page instead. This is what bounds how long a
 * stored KV page is served, so its asset URLs are never stale. See
 * functions/blog/_middleware.js.
 */
export function GET() {
  return new Response(JSON.stringify({ builtAt: Date.now() }), {
    headers: { 'content-type': 'application/json' },
  });
}
