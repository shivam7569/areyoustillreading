/**
 * GET /early?t=<token> — serve an early-access draft to a subscriber.
 * =============================================================================
 * The token (minted by functions/api/admin/early.js and emailed to confirmed
 * subscribers) maps in KV to a post slug whose rendered HTML lives in POSTS_HTML
 * (the same instant-publish overlay). We serve that HTML — even though the post is
 * a draft (the public /blog route refuses drafts, see functions/blog/_middleware.js).
 *
 * Unguessable UUID token = soft gating for a subscriber early-read, NOT a hard
 * paywall (a subscriber could share the link). Any missing/expired/unknown token
 * just redirects to the blog. `noindex` so the early page never gets crawled.
 */
export async function onRequestGet({ request, env }) {
  const kv = env.POSTS_HTML;
  const token = new URL(request.url).searchParams.get('t') || '';
  const toBlog = () => Response.redirect(new URL('/blog', request.url).toString(), 302);

  if (!kv || !/^[0-9a-f]{16,64}$/i.test(token)) return toBlog();

  let meta;
  try { meta = JSON.parse((await kv.get(`early:${token}`)) || 'null'); } catch { meta = null; }
  if (!meta || !meta.slug) return toBlog();
  if (meta.exp && Date.now() > meta.exp) return toBlog(); // expired

  let entry;
  try { entry = JSON.parse((await kv.get(meta.slug)) || 'null'); } catch { entry = null; }
  if (!entry || typeof entry.html !== 'string') return toBlog();

  return new Response(entry.html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'private, no-store',
      'x-robots-tag': 'noindex, nofollow',
    },
  });
}
