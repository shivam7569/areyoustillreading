/**
 * functions/sitemap-posts.xml.js — the runtime sitemap of DB-served permalinks.
 * ============================================================================
 * @astrojs/sitemap emits /sitemap-index.xml for the STATIC routes at build. But essays publish
 * into content.posts and are served at /@handle/slug by the edge middleware — those URLs never
 * exist as build routes, so they need a sitemap generated at request time. Reads
 * public.sitemap_entries() (published/public posts + author pages) with the anon key and emits a
 * standard <urlset>. Referenced from robots.txt alongside the static sitemap.
 */
async function rpc(env, fn, args) {
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
  const rows = (await rpc(env, 'sitemap_entries')) || [];

  const urls = rows.filter((r) => r && r.loc).map((r) => {
    const lastmod = r.lastmod ? `\n    <lastmod>${new Date(r.lastmod).toISOString().slice(0, 10)}</lastmod>` : '';
    return `  <url>\n    <loc>${esc(origin + r.loc)}/</loc>${lastmod}\n  </url>`;
  }).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;

  return new Response(xml, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}
