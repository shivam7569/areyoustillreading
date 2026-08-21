/**
 * functions/rss.xml.js — the RSS 2.0 feed, served at the EDGE from the database.
 * ============================================================================
 * Replaces the old build-time `src/pages/rss.xml.js`, which read the file-based `blog` content
 * collection. Posts now publish into `content.posts` and go live instantly (no rebuild), so the
 * feed MUST be generated at request time — otherwise new essays never appear until the next build.
 *
 * Reads `public.list_feed_posts` (published, public posts, newest-first) with the anon key, and
 * links to the canonical `/@handle/slug` permalinks the edge middleware serves. Emits only
 * title / description / link — never the body — so nothing gated can leak through the feed.
 *
 * Cloudflare Pages serves static assets before Functions, so this only runs because the build no
 * longer emits a static `/rss.xml` (the old page was deleted).
 */
async function feedRpc(env, fn, args) {
  const sb = env && env.SUPABASE_URL;
  const key = env && (env.PUBLIC_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_ROLE_KEY);
  if (!sb || !key) return null;
  try {
    const r = await fetch(`${sb}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, apikey: key, 'content-type': 'application/json' },
      body: JSON.stringify(args || {}),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

const esc = (s) => String(s == null ? '' : s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

export async function onRequest(context) {
  const { request, env } = context;
  const origin = new URL(request.url).origin;
  const posts = (await feedRpc(env, 'list_feed_posts', { p_limit: 50 })) || [];

  const items = posts.filter((p) => p && p.pub_date && p.primary_handle && p.slug).map((p) => {
    const link = `${origin}/@${esc(p.primary_handle)}/${esc(p.slug)}/`;
    const creator = p.primary_name ? `\n      <dc:creator>${esc(p.primary_name)}</dc:creator>` : '';
    return `    <item>
      <title>${esc(p.title)}</title>
      <link>${link}</link>
      <guid isPermaLink="true">${link}</guid>
      <pubDate>${new Date(p.pub_date).toUTCString()}</pubDate>${creator}
      <description>${esc(p.description)}</description>
    </item>`;
  }).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>areyoustillreading</title>
    <link>${origin}/</link>
    <atom:link href="${origin}/rss.xml" rel="self" type="application/rss+xml"/>
    <description>Notes on LLM engineering, plus the projects behind them.</description>
    <language>en</language>
${items}
  </channel>
</rss>
`;

  return new Response(xml, {
    headers: {
      'content-type': 'application/rss+xml; charset=utf-8',
      'cache-control': 'public, max-age=600',
    },
  });
}
