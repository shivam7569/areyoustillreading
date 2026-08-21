/**
 * functions/ogp/[handle]/[slug].js — per-post OG image with a graceful default.
 * ============================================================================
 * A DB post's og:image points here (/ogp/<handle>/<slug>). The per-post card itself is a STATIC
 * PNG generated at build by src/pages/og/[...route].ts at /og/<handle>/<slug>.png. This tiny
 * Function just decides which image to hand the crawler:
 *   • if the static per-post card exists → serve its bytes
 *   • else (a post newer than the last build, or beyond the OG cap) → serve the branded default
 * so a share preview is ALWAYS a valid image, never a 404. It's deliberately a plain asset lookup
 * — NO satori/resvg/wasm — so it can never bloat or break the Functions bundle.
 */
export async function onRequest(context) {
  const { params, env, request } = context;
  const origin = new URL(request.url).origin;
  const cardPath = `/og/${params.handle}/${params.slug}.png`;

  async function asset(path) {
    if (!(env && env.ASSETS && env.ASSETS.fetch)) return null;
    try {
      const r = await env.ASSETS.fetch(new Request(origin + path));
      return r && r.ok ? r : null;
    } catch { return null; }
  }

  const card = await asset(cardPath);
  const src = card || (await asset('/og/aysr.png'));
  if (!src) return new Response('Not found', { status: 404 });
  return new Response(request.method === 'HEAD' ? null : src.body, {
    headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' },
  });
}
