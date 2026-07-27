/**
 * /api/admin/post — single-post admin operations (all admin-gated).
 * ----------------------------------------------------------------------------
 *   GET    ?slug=<slug>            → load a post's Markdown + sha for editing
 *   POST   { slug, draft:boolean } → flip the draft flag (publish / unpublish)
 *   DELETE ?slug=<slug>            → delete the post entirely
 *
 * Every mutation commits to the same GitHub content collection /api/publish uses
 * (which triggers the Cloudflare rebuild) and keeps the instant KV overlay in
 * sync so an unpublish/delete disappears in seconds, not after the next build.
 */
import { requireAdmin, json } from '../../../lib/require-admin.js';
import { parseFrontmatter } from '../../../lib/list-posts.js';

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

const toBase64Utf8 = (str) => btoa(String.fromCharCode(...new TextEncoder().encode(str)));
function decodeBase64Utf8(b64) {
  const bin = atob(String(b64 || '').replace(/\s+/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}
function ghHeaders(env) {
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'aysr-admin',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}
function repoInfo(env) {
  return { repo: env.GITHUB_REPO || 'shivam7569/areyoustillreading', branch: env.GITHUB_BRANCH || 'main' };
}
function fileApi(env, slug) {
  const { repo } = repoInfo(env);
  return `https://api.github.com/repos/${repo}/contents/src/content/blog/${slug}.md`;
}

// Look up a post file: returns { sha, content } or null (404). Throws on hard error.
async function getFile(env, slug) {
  const { branch } = repoInfo(env);
  const r = await fetch(`${fileApi(env, slug)}?ref=${encodeURIComponent(branch)}`, { headers: ghHeaders(env) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub lookup failed (${r.status})`);
  const j = await r.json();
  return { sha: j.sha, content: decodeBase64Utf8(j.content) };
}

// Set (or insert) the `draft:` frontmatter flag via a targeted edit — never a
// full re-serialize, so the rest of the file is preserved byte-for-byte.
function setDraftFlag(raw, draft) {
  const m = /^(---\r?\n)([\s\S]*?)(\r?\n---)/.exec(raw);
  if (!m) return `---\ndraft: ${draft}\n---\n\n${raw}`;
  let fm = m[2];
  if (/^draft:\s*.*$/m.test(fm)) fm = fm.replace(/^draft:\s*.*$/m, `draft: ${draft}`);
  else fm = `${fm}\ndraft: ${draft}`;
  return m[1] + fm + m[3] + raw.slice(m[0].length);
}

// Remove a post from the instant overlay: drop its rendered HTML + index entry.
async function kvUnpublish(env, slug) {
  if (!env.POSTS_HTML) return;
  try {
    await env.POSTS_HTML.delete(slug);
  } catch {
    /* best-effort */
  }
  try {
    const idxRaw = await env.POSTS_HTML.get('__index');
    const idx = idxRaw ? JSON.parse(idxRaw) : [];
    if (Array.isArray(idx)) {
      await env.POSTS_HTML.put('__index', JSON.stringify(idx.filter((p) => p && p.slug !== slug)));
    }
  } catch {
    /* best-effort */
  }
}

export async function onRequestGet({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (!gate.ok) return json({ error: gate.error }, gate.status);
  const slug = new URL(request.url).searchParams.get('slug') || '';
  if (!SLUG_RE.test(slug)) return json({ error: 'Invalid slug' }, 400);
  let file;
  try {
    file = await getFile(env, slug);
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 502);
  }
  if (!file) return json({ error: 'Not found' }, 404);
  return json({ slug, markdown: file.content, sha: file.sha, frontmatter: parseFrontmatter(file.content) });
}

export async function onRequestPost({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (!gate.ok) return json({ error: gate.error }, gate.status);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const slug = body && body.slug;
  const draft = Boolean(body && body.draft);
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) return json({ error: 'Invalid slug' }, 400);

  let file;
  try {
    file = await getFile(env, slug);
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 502);
  }
  if (!file) return json({ error: 'Not found' }, 404);

  const { branch } = repoInfo(env);
  const updated = setDraftFlag(file.content, draft);
  const put = await fetch(fileApi(env, slug), {
    method: 'PUT',
    headers: ghHeaders(env),
    body: JSON.stringify({
      message: `${draft ? 'Unpublish' : 'Publish'} post: ${slug}`,
      content: toBase64Utf8(updated),
      branch,
      sha: file.sha,
    }),
  });
  if (!put.ok) return json({ error: 'GitHub commit failed', detail: (await put.text()).slice(0, 300) }, 502);

  // Unpublishing must also pull the post out of the instant overlay immediately.
  if (draft) await kvUnpublish(env, slug);
  return json({ ok: true, slug, draft });
}

export async function onRequestDelete({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (!gate.ok) return json({ error: gate.error }, gate.status);
  const slug = new URL(request.url).searchParams.get('slug') || '';
  if (!SLUG_RE.test(slug)) return json({ error: 'Invalid slug' }, 400);

  let file;
  try {
    file = await getFile(env, slug);
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 502);
  }
  // Already absent from the repo → just make sure the overlay is clean.
  if (!file) {
    await kvUnpublish(env, slug);
    return json({ ok: true, slug, deleted: true, note: 'not in repo' });
  }

  const { branch } = repoInfo(env);
  const del = await fetch(fileApi(env, slug), {
    method: 'DELETE',
    headers: ghHeaders(env),
    body: JSON.stringify({ message: `Delete post: ${slug}`, branch, sha: file.sha }),
  });
  if (!del.ok) return json({ error: 'GitHub delete failed', detail: (await del.text()).slice(0, 300) }, 502);

  await kvUnpublish(env, slug);
  return json({ ok: true, slug, deleted: true });
}
