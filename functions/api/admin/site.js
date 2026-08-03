/**
 * /api/admin/site — manage site-wide page copy from the Studio. Admin-gated.
 * ----------------------------------------------------------------------------
 *   GET               → src/data/site.json (parsed) + sha
 *   POST { content }  → commit src/data/site.json
 *
 * Same publish model as the resume + projects endpoints: a GitHub Contents-API
 * commit that triggers the Cloudflare rebuild (~1 min). This is the backing
 * store for Studio → Content Management, which makes every page's editorial
 * copy editable. Public pages import src/data/site.json at build time.
 *
 * SECURITY: requireAdmin() gates every method; GITHUB_TOKEN never reaches the
 * client. The body must be a plain JSON object (copy tree), never an array.
 */
import { requireAdmin, json } from '../../../lib/require-admin.js';
import { toBase64Utf8, fromBase64Utf8 } from '../../../lib/base64.js';

const SITE_JSON = 'src/data/site.json';

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
  return { sha: j.sha, base64: j.content || '' };
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

export async function onRequestGet({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (!gate.ok) return json({ error: gate.error }, gate.status);
  let file;
  try {
    file = await getFile(env, SITE_JSON);
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 502);
  }
  if (!file) return json({ error: 'site.json not found in the repo' }, 404);
  let content;
  try {
    content = JSON.parse(fromBase64Utf8(file.base64));
  } catch {
    return json({ error: 'site.json is not valid JSON' }, 502);
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
  const content = body && body.content;
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    return json({ error: 'Invalid site content' }, 400);
  }
  let existing;
  try { existing = await getFile(env, SITE_JSON); } catch (e) { return json({ error: String((e && e.message) || e) }, 502); }
  const serialized = JSON.stringify(content, null, 2) + '\n';
  try {
    await putFile(env, SITE_JSON, { message: 'chore(site): update copy from Studio', contentBase64: toBase64Utf8(serialized), sha: existing ? existing.sha : undefined });
  } catch (e) { return json({ error: String((e && e.message) || e) }, 502); }
  return json({ ok: true });
}
