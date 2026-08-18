/**
 * /api/admin/series — manage SERIES DEFINITIONS from the Studio. Admin-gated.
 * ----------------------------------------------------------------------------
 *   GET               → src/data/series.json ({ series: [...] }) + sha
 *   POST { content }  → commit src/data/series.json
 *
 * WHY A DEFINITIONS FILE: a series is otherwise only the set of posts that share
 * a `series` slug — so it can't exist (or carry planned parts / total / status)
 * until a post is published into it. This file lets the Studio's Series page
 * CREATE a series up front (name + planned knobs), which the public /series plate
 * then reads by slug. Posts still join a series purely by their `series` frontmatter
 * (set from the publish sheet, unchanged) — this store only holds the collection-
 * level knobs, keyed by the same slugify() the publish sheet uses.
 *
 * Same commit-to-GitHub model as /api/admin/site (→ Cloudflare rebuild ~1 min).
 * SECURITY: requireAdmin() gates every method; GITHUB_TOKEN never reaches the client.
 */
import { requireAdmin, json } from '../../../lib/require-admin.js';
import { toBase64Utf8, fromBase64Utf8 } from '../../../lib/base64.js';

const SERIES_JSON = 'src/data/series.json';

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

// Keep only the fields we own, normalized — never trust the client's shape.
function sanitize(content) {
  const arr = content && Array.isArray(content.series) ? content.series : [];
  const seen = new Set();
  const series = [];
  for (const s of arr) {
    const slug = String((s && s.slug) || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    const total = Number(s && s.total);
    const status = ['in-progress', 'complete', 'paused'].includes(s && s.status) ? s.status : '';
    const planned = Array.isArray(s && s.planned) ? s.planned.map((t) => String(t || '').trim()).filter(Boolean).slice(0, 24) : [];
    series.push({
      slug,
      title: String((s && s.title) || slug).trim().slice(0, 120),
      summary: String((s && s.summary) || '').trim().slice(0, 600),
      total: Number.isFinite(total) && total > 0 ? Math.round(total) : null,
      status,
      planned,
    });
  }
  return { series };
}

export async function onRequestGet({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (!gate.ok) return json({ error: gate.error }, gate.status);
  let file;
  try {
    file = await getFile(env, SERIES_JSON);
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 502);
  }
  if (!file) return json({ content: { series: [] }, sha: null }); // not created yet → empty
  let content;
  try {
    content = JSON.parse(fromBase64Utf8(file.base64));
  } catch {
    return json({ error: 'series.json is not valid JSON' }, 502);
  }
  return json({ content: sanitize(content), sha: file.sha });
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
  const content = sanitize(body && body.content);
  let existing;
  try { existing = await getFile(env, SERIES_JSON); } catch (e) { return json({ error: String((e && e.message) || e) }, 502); }
  const serialized = JSON.stringify(content, null, 2) + '\n';
  try {
    await putFile(env, SERIES_JSON, { message: 'chore(series): update series from Studio', contentBase64: toBase64Utf8(serialized), sha: existing ? existing.sha : undefined });
  } catch (e) { return json({ error: String((e && e.message) || e) }, 502); }
  return json({ ok: true, series: content.series });
}
