/**
 * /api/admin/projects — manage the Projects page from the Studio. Admin-gated.
 * ----------------------------------------------------------------------------
 *   GET                                   → src/data/projects.json (parsed) + sha
 *   POST { content }                      → commit src/data/projects.json
 *   POST { action:'shot', id, imgBase64, name } → commit public/projects/<id>.<ext>
 *   DELETE ?shot&id=<id>&ext=<ext>        → remove that screenshot
 *
 * Same publish model as posts + the resume page: a GitHub Contents-API commit
 * that triggers the Cloudflare rebuild (~1 min). The public /projects page renders
 * projects.json at build time; screenshots (optional — the default artwork is a
 * generated plate) are committed under public/projects/ and served from there.
 *
 * SECURITY: requireAdmin() gates every method; GITHUB_TOKEN never reaches the
 * client. Uploads are validated as real images under a size cap before commit.
 */
import { requireAdmin, json } from '../../../lib/require-admin.js';
import { toBase64Utf8, fromBase64Utf8 } from '../../../lib/base64.js';
// INSTANT overlay: mirror text-only edits to KV so the copy middleware reflects them
// in seconds. textOnlyEdit gates the "instant" claim — a layout/row change is NOT
// overlay-able (the per-string text overlay can't add/remove/re-attribute DOM), so it
// falls back to the rebuild. Keep this regex in lockstep with the data-cms anchors on
// src/pages/projects.astro (the case-study body fields).
import { writeCopy, textOnlyEdit } from '../../../lib/site-copy.js';

const PROJECTS_JSON = 'src/data/projects.json';
const PROJECTS_ANCHORED_RE = /^projects\.\d+\.(name|lead|tags\.\d+|families\.heading|families\.count\.(fig|cap)|families\.rows\.\d+\.(n|v|sub)|build\.heading|build\.items\.\d+)$/;
const MAX_IMG_BYTES = 4 * 1024 * 1024; // 4 MB — a screenshot is far smaller
const OK_EXT = { png: 'png', jpg: 'jpg', jpeg: 'jpg', webp: 'webp' };
const ID_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

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
function contentsApi(env, path) {
  return `https://api.github.com/repos/${repoInfo(env).repo}/contents/${path}`;
}
async function getFile(env, path) {
  const { branch } = repoInfo(env);
  const r = await fetch(`${contentsApi(env, path)}?ref=${encodeURIComponent(branch)}`, { headers: ghHeaders(env) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub lookup failed (${r.status})`);
  const j = await r.json();
  return { sha: j.sha, base64: j.content || '', size: j.size || 0 };
}
async function putFile(env, path, { message, contentBase64, sha }) {
  const { branch } = repoInfo(env);
  const r = await fetch(contentsApi(env, path), {
    method: 'PUT',
    headers: ghHeaders(env),
    body: JSON.stringify({ message, content: contentBase64, branch, ...(sha ? { sha } : {}) }),
  });
  if (!r.ok) throw new Error('GitHub commit failed: ' + (await r.text()).slice(0, 300));
  return r.json();
}
async function deleteFile(env, path, { message, sha }) {
  const { branch } = repoInfo(env);
  const r = await fetch(contentsApi(env, path), {
    method: 'DELETE',
    headers: ghHeaders(env),
    body: JSON.stringify({ message, branch, sha }),
  });
  if (!r.ok) throw new Error('GitHub delete failed: ' + (await r.text()).slice(0, 300));
  return r.json();
}

// Detect an image from its first bytes (PNG / JPEG / WEBP). Returns true/false.
function looksLikeImage(b64) {
  let head;
  try { head = atob(b64.slice(0, 24)); } catch { return false; }
  const code = (i) => head.charCodeAt(i);
  if (code(0) === 0x89 && head.slice(1, 4) === 'PNG') return true; // PNG
  if (code(0) === 0xff && code(1) === 0xd8 && code(2) === 0xff) return true; // JPEG
  if (head.slice(0, 4) === 'RIFF' && head.slice(8, 12) === 'WEBP') return true; // WEBP
  return false;
}

export async function onRequestGet({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (!gate.ok) return json({ error: gate.error }, gate.status);
  let file;
  try {
    file = await getFile(env, PROJECTS_JSON);
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 502);
  }
  if (!file) return json({ error: 'projects.json not found in the repo' }, 404);
  let content;
  try {
    content = JSON.parse(fromBase64Utf8(file.base64));
  } catch {
    return json({ error: 'projects.json is not valid JSON' }, 502);
  }
  return json({ content, sha: file.sha });
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

  // --- screenshot upload ---
  if (body && body.action === 'shot') {
    const id = String(body.id || '');
    if (!ID_RE.test(id)) return json({ error: 'Invalid project id' }, 400);
    const b64 = typeof body.imgBase64 === 'string' ? body.imgBase64.trim() : '';
    if (!b64) return json({ error: 'No image data' }, 400);
    if (b64.length * 0.75 > MAX_IMG_BYTES) return json({ error: 'Image too large (max 4 MB)' }, 400);
    if (!looksLikeImage(b64)) return json({ error: 'That file is not a PNG, JPEG or WEBP image' }, 400);
    const rawExt = String(body.name || '').split('.').pop().toLowerCase();
    const ext = OK_EXT[rawExt] || 'png';
    const path = `public/projects/${id}.${ext}`;
    let existing;
    try { existing = await getFile(env, path); } catch (e) { return json({ error: String((e && e.message) || e) }, 502); }
    try {
      await putFile(env, path, { message: `chore(projects): screenshot for ${id}`, contentBase64: b64, sha: existing ? existing.sha : undefined });
    } catch (e) { return json({ error: String((e && e.message) || e) }, 502); }
    return json({ ok: true, shot: `/projects/${id}.${ext}` });
  }

  // --- content save ---
  const content = body && body.content;
  if (!content || typeof content !== 'object' || !Array.isArray(content.projects)) {
    return json({ error: 'Invalid projects content' }, 400);
  }
  let existing;
  try { existing = await getFile(env, PROJECTS_JSON); } catch (e) { return json({ error: String((e && e.message) || e) }, 502); }
  const serialized = JSON.stringify(content, null, 2) + '\n';
  try {
    await putFile(env, PROJECTS_JSON, { message: 'chore(projects): update from Studio', contentBase64: toBase64Utf8(serialized), sha: existing ? existing.sha : undefined });
  } catch (e) { return json({ error: String((e && e.message) || e) }, 502); }
  // Instant overlay for a TEXT-ONLY edit; otherwise clear any stale overlay so the
  // page serves the fresh static build once the rebuild lands (no partial overlay).
  let oldContent = null;
  if (existing) { try { oldContent = JSON.parse(fromBase64Utf8(existing.base64)); } catch {} }
  let instant = false;
  if (oldContent && textOnlyEdit(oldContent, content, PROJECTS_ANCHORED_RE)) {
    instant = await writeCopy(env, 'copy:projects', content);
  } else {
    try { if (env.POSTS_HTML) await env.POSTS_HTML.delete('copy:projects'); } catch {}
  }
  return json({ ok: true, instant });
}

export async function onRequestDelete({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (!gate.ok) return json({ error: gate.error }, gate.status);
  const url = new URL(request.url);
  if (!url.searchParams.has('shot')) return json({ error: 'Nothing to delete' }, 400);
  const id = String(url.searchParams.get('id') || '');
  const ext = OK_EXT[String(url.searchParams.get('ext') || 'png').toLowerCase()] || 'png';
  if (!ID_RE.test(id)) return json({ error: 'Invalid project id' }, 400);
  const path = `public/projects/${id}.${ext}`;
  let existing;
  try { existing = await getFile(env, path); } catch (e) { return json({ error: String((e && e.message) || e) }, 502); }
  if (!existing) return json({ ok: true }); // already gone
  try {
    await deleteFile(env, path, { message: `chore(projects): remove screenshot for ${id}`, sha: existing.sha });
  } catch (e) { return json({ error: String((e && e.message) || e) }, 502); }
  return json({ ok: true });
}
