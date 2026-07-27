/*
 * POST /api/publish — commit a post's Markdown file to the GitHub repo so the
 * Cloudflare Pages Git-integration rebuilds and deploys it (Option B publishing).
 *
 * The admin editor is currently UNGATED (single-user dev), so this endpoint — which
 * has write access to the repo via GITHUB_TOKEN — MUST NOT be open. It requires a
 * shared secret (PUBLISH_SECRET) that the author enters at publish time; the secret
 * is never embedded in the client bundle.
 *
 * Env (Cloudflare Pages project settings):
 *   GITHUB_TOKEN   — fine-grained PAT with Contents: write on the repo (required)
 *   PUBLISH_SECRET — shared secret the editor must send (required)
 *   GITHUB_REPO    — "owner/name" (default: shivam7569/areyoustillreading)
 *   GITHUB_BRANCH  — branch to commit to (default: main → production build)
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

  const { slug, content, secret } = payload || {};

  // --- Auth: shared secret --------------------------------------------------
  if (!env.PUBLISH_SECRET) return json({ error: 'Server not configured (PUBLISH_SECRET)' }, 500);
  if (typeof secret !== 'string' || secret !== env.PUBLISH_SECRET) return json({ error: 'Unauthorized' }, 401);

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
