/*
 * POST /api/publish — commit a post's Markdown file to the GitHub repo so the
 * Cloudflare Pages Git-integration rebuilds and deploys it (Option B publishing).
 *
 * This endpoint has write access to the repo via GITHUB_TOKEN, so it MUST NOT be
 * open: the caller must present a valid Supabase session (Authorization: Bearer
 * <access_token>) belonging to an admin (public.admins). No secret is ever typed by
 * the author or embedded in the client — auth is the normal one-time sign-in.
 *
 * Env (Cloudflare Pages project settings):
 *   GITHUB_TOKEN              — fine-grained PAT with Contents: write on the repo
 *   SUPABASE_URL              — Supabase project base URL (auth + admin check)
 *   SUPABASE_SERVICE_ROLE_KEY — service role (validates token, reads public.admins)
 *   GITHUB_REPO               — "owner/name" (default: shivam7569/areyoustillreading)
 *   GITHUB_BRANCH             — branch to commit to (default: main → production build)
 */
const JSON_HEADERS = { 'content-type': 'application/json' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

// Base64 of a UTF-8 string (btoa alone mangles non-Latin1).
const toBase64Utf8 = (str) => btoa(String.fromCharCode(...new TextEncoder().encode(str)));

export async function onRequestPost({ request, env }) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { slug, content } = payload || {};

  // --- Auth: caller must be a signed-in admin (Supabase session) ------------
  const sb = env.SUPABASE_URL;
  const service = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sb || !service) return json({ error: 'Server not configured (Supabase)' }, 500);
  const authToken = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!authToken) return json({ error: 'Not signed in' }, 401);
  // Validate the token → resolve the user (delegated to Supabase, never decoded here).
  const userRes = await fetch(`${sb}/auth/v1/user`, { headers: { Authorization: `Bearer ${authToken}`, apikey: service } });
  if (!userRes.ok) return json({ error: 'Session expired — sign in again' }, 401);
  const user = await userRes.json();
  // Is this user the site owner? public.admins has no RLS select policy → service role.
  const adminRes = await fetch(`${sb}/rest/v1/admins?select=user_id&user_id=eq.${user.id}`, {
    headers: { Authorization: `Bearer ${service}`, apikey: service },
  });
  const admins = adminRes.ok ? await adminRes.json() : [];
  if (!admins.length) return json({ error: 'Not authorized to publish' }, 403);

  // --- Validate -------------------------------------------------------------
  if (typeof slug !== 'string' || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug)) {
    return json({ error: 'Invalid slug (use lowercase letters, digits, hyphens)' }, 400);
  }
  if (typeof content !== 'string' || !content.trim()) return json({ error: 'Missing content' }, 400);

  const token = env.GITHUB_TOKEN;
  if (!token) return json({ error: 'Server not configured (GITHUB_TOKEN)' }, 500);
  const repo = env.GITHUB_REPO || 'shivam7569/areyoustillreading';
  const branch = env.GITHUB_BRANCH || 'main';
  const path = `src/content/blog/${slug}.md`;
  const api = `https://api.github.com/repos/${repo}/contents/${path}`;
  const gh = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'aysr-publisher',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  try {
    // If the file already exists on this branch we need its blob SHA to update it.
    let sha;
    const head = await fetch(`${api}?ref=${encodeURIComponent(branch)}`, { headers: gh });
    if (head.status === 200) sha = (await head.json()).sha;
    else if (head.status !== 404) {
      return json({ error: 'GitHub lookup failed', status: head.status, detail: (await head.text()).slice(0, 300) }, 502);
    }

    const put = await fetch(api, {
      method: 'PUT',
      headers: gh,
      body: JSON.stringify({
        message: `${sha ? 'Update' : 'Publish'} post: ${slug}`,
        content: toBase64Utf8(content),
        branch,
        ...(sha ? { sha } : {}),
      }),
    });
    if (!put.ok) {
      return json({ error: 'GitHub commit failed', status: put.status, detail: (await put.text()).slice(0, 400) }, 502);
    }
    const data = await put.json();
    return json({
      ok: true,
      path,
      branch,
      updated: Boolean(sha),
      commit: data.commit?.sha,
      fileUrl: data.content?.html_url,
    });
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 500);
  }
}
