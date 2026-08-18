/**
 * /api/admin/fields — manage FIELD DEFINITIONS from the Studio. Admin-gated.
 * ----------------------------------------------------------------------------
 *   GET               → src/data/fields.json ({ fields: [...] }) + sha
 *   POST { content }  → commit src/data/fields.json
 *
 * A field groups related SERIES (one level above them). It's defined here — a
 * title, a summary, a chosen mark, and an ordered list of member series (by slug,
 * each with an optional note) — and referenced by the public /fields pages. A field
 * only becomes visible to readers once ≥2 of its member series are public; that rule
 * is enforced at build (src/lib/fields.ts), not here, so an author can assemble a
 * field ahead of its second series.
 *
 * Same commit-to-GitHub model as /api/admin/series (→ Cloudflare rebuild ~1 min).
 * SECURITY: requireAdmin() gates every method; GITHUB_TOKEN never reaches the client.
 */
import { requireAdmin, json } from '../../../lib/require-admin.js';
import { toBase64Utf8, fromBase64Utf8 } from '../../../lib/base64.js';

const FIELDS_JSON = 'src/data/fields.json';
const MARKS = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10'];

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
  // cacheTtl:0 — never let Cloudflare's edge serve a stale GitHub read; the Studio
  // relies on read-after-write freshness for both the sha (writes) and the UI (reads).
  const r = await fetch(`${contentsApi(env, path)}?ref=${encodeURIComponent(branch)}`, { headers: ghHeaders(env), cf: { cacheTtl: 0, cacheEverything: false } });
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

const slugify = (x) => String(x || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// Keep only the fields we own, normalized — never trust the client's shape.
function sanitize(content) {
  const arr = content && Array.isArray(content.fields) ? content.fields : [];
  const seen = new Set();
  const fields = [];
  for (const f of arr) {
    const slug = slugify(f && f.slug);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    const mark = MARKS.includes(f && f.mark) ? f.mark : '01';
    const rawSeries = Array.isArray(f && f.series) ? f.series : [];
    const seenS = new Set();
    const series = [];
    for (const s of rawSeries) {
      const sSlug = typeof s === 'string' ? slugify(s) : slugify(s && s.slug);
      if (!sSlug || seenS.has(sSlug)) continue;
      seenS.add(sSlug);
      const note = s && typeof s === 'object' && s.note ? String(s.note).trim().slice(0, 200) : '';
      series.push(note ? { slug: sSlug, note } : { slug: sSlug });
      if (series.length >= 48) break;
    }
    fields.push({
      slug,
      title: String((f && f.title) || slug).trim().slice(0, 120),
      summary: String((f && f.summary) || '').trim().slice(0, 600),
      mark,
      series,
    });
  }
  return { fields };
}

export async function onRequestGet({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (!gate.ok) return json({ error: gate.error }, gate.status);
  let file;
  try {
    file = await getFile(env, FIELDS_JSON);
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 502);
  }
  if (!file) return json({ content: { fields: [] }, sha: null }); // not created yet → empty
  let content;
  try {
    content = JSON.parse(fromBase64Utf8(file.base64));
  } catch {
    return json({ error: 'fields.json is not valid JSON' }, 502);
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
  try { existing = await getFile(env, FIELDS_JSON); } catch (e) { return json({ error: String((e && e.message) || e) }, 502); }
  const serialized = JSON.stringify(content, null, 2) + '\n';
  try {
    await putFile(env, FIELDS_JSON, { message: 'chore(fields): update fields from Studio', contentBase64: toBase64Utf8(serialized), sha: existing ? existing.sha : undefined });
  } catch (e) { return json({ error: String((e && e.message) || e) }, 502); }
  return json({ ok: true, fields: content.fields });
}
