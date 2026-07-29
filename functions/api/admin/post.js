/**
 * /api/admin/post — single-post admin operations (all admin-gated).
 * ----------------------------------------------------------------------------
 *   GET    ?slug=<slug>            → load a post's Markdown + sha for editing
 *   POST   { slug, draft?:boolean, gateable?:boolean, series?:null|{title,order} }
 *                                  → flip draft / gateable, or set/clear series membership
 *   DELETE ?slug=<slug>            → delete the post entirely
 *
 * Every mutation commits to the same GitHub content collection /api/publish uses
 * (which triggers the Cloudflare rebuild) and keeps the instant KV overlay in
 * sync so an unpublish/delete disappears in seconds, not after the next build.
 */
import { requireAdmin, json } from '../../../lib/require-admin.js';
import { parseFrontmatter } from '../../../lib/list-posts.js';
import { toBase64Utf8, fromBase64Utf8 } from '../../../lib/base64.js';

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

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
  return { sha: j.sha, content: fromBase64Utf8(j.content) };
}

// Set (or insert) a boolean frontmatter flag (draft / gateable) via a targeted edit —
// never a full re-serialize, so the rest of the file is preserved byte-for-byte.
function setBoolFlag(raw, key, value) {
  const m = /^(---\r?\n)([\s\S]*?)(\r?\n---)/.exec(raw);
  if (!m) return `---\n${key}: ${value}\n---\n\n${raw}`;
  let fm = m[2];
  const re = new RegExp(`^${key}:\\s*.*$`, 'm');
  if (re.test(fm)) fm = fm.replace(re, `${key}: ${value}`);
  else fm = `${fm}\n${key}: ${value}`;
  return m[1] + fm + m[3] + raw.slice(m[0].length);
}

// Set (or insert) a scalar frontmatter field to a pre-serialized value (already
// quoted/number). Same targeted, byte-preserving edit as setBoolFlag.
function setScalarField(raw, key, serialized) {
  const m = /^(---\r?\n)([\s\S]*?)(\r?\n---)/.exec(raw);
  if (!m) return `---\n${key}: ${serialized}\n---\n\n${raw}`;
  let fm = m[2];
  const re = new RegExp(`^${key}:\\s*.*$`, 'm');
  if (re.test(fm)) fm = fm.replace(re, `${key}: ${serialized}`);
  else fm = `${fm}\n${key}: ${serialized}`;
  return m[1] + fm + m[3] + raw.slice(m[0].length);
}

// Remove one or more frontmatter keys entirely (their whole line). Used to take a
// post out of a series (drop series / seriesTitle / seriesOrder).
function removeFields(raw, keys) {
  const m = /^(---\r?\n)([\s\S]*?)(\r?\n---)/.exec(raw);
  if (!m) return raw;
  let fm = m[2];
  for (const key of keys) {
    fm = fm.replace(new RegExp(`^${key}:\\s*.*$\\r?\\n?`, 'm'), '');
  }
  return m[1] + fm.replace(/\r?\n$/, '') + m[3] + raw.slice(m[0].length);
}

// Slugify a series display name the same way the editor does (grouping key).
function slugify(s) {
  return String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
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
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) return json({ error: 'Invalid slug' }, 400);
  // Flip whichever frontmatter booleans were provided: `draft` (publish/unpublish) and
  // `gateable` (add/remove the post from the paywall — build-time body split), or update
  // `series` membership. `series` is null (remove) or { title, order } (add/update). At
  // least one must be present.
  const hasDraft = typeof body.draft === 'boolean';
  const hasGateable = typeof body.gateable === 'boolean';
  const hasSeries = Object.prototype.hasOwnProperty.call(body, 'series');
  if (!hasDraft && !hasGateable && !hasSeries) return json({ error: 'Nothing to change' }, 400);
  if (hasSeries && body.series !== null && (typeof body.series !== 'object' || !String(body.series.title || '').trim())) {
    return json({ error: 'A series needs a name' }, 400);
  }

  let file;
  try {
    file = await getFile(env, slug);
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 502);
  }
  if (!file) return json({ error: 'Not found' }, 404);

  const { branch } = repoInfo(env);
  let updated = file.content;
  const actions = [];
  if (hasDraft) {
    updated = setBoolFlag(updated, 'draft', body.draft);
    actions.push(body.draft ? 'unpublish' : 'publish');
  }
  if (hasGateable) {
    updated = setBoolFlag(updated, 'gateable', body.gateable);
    actions.push(body.gateable ? 'paywall' : 'unpaywall');
  }
  if (hasSeries) {
    if (body.series === null) {
      updated = removeFields(updated, ['series', 'seriesTitle', 'seriesOrder']);
      actions.push('series-clear');
    } else {
      const title = String(body.series.title).trim();
      const order = Number(body.series.order);
      updated = setScalarField(updated, 'series', JSON.stringify(slugify(title)));
      updated = setScalarField(updated, 'seriesTitle', JSON.stringify(title));
      if (Number.isFinite(order) && order > 0) updated = setScalarField(updated, 'seriesOrder', String(Math.round(order)));
      else updated = removeFields(updated, ['seriesOrder']);
      actions.push('series-set');
    }
  }

  let put;
  try {
    put = await fetch(fileApi(env, slug), {
      method: 'PUT',
      headers: ghHeaders(env),
      body: JSON.stringify({
        message: `${actions.join(' + ')} post: ${slug}`,
        content: toBase64Utf8(updated),
        branch,
        sha: file.sha,
      }),
    });
  } catch (e) {
    return json({ error: 'Commit failed: ' + String((e && e.message) || e) }, 502);
  }
  if (!put.ok) return json({ error: 'GitHub commit failed', detail: (await put.text()).slice(0, 300) }, 502);

  // Drop the instant KV copy whenever visibility OR gating changes: the stored copy is
  // the pre-change render, so serving it during the ~1-2 min rebuild would show stale
  // (and for a newly-paywalled post, unsafe) content. Falling back to static is correct.
  // Series-only changes are build-time (the /series page + in-post nav rebuild); they
  // don't make the instant KV copy stale/unsafe, so we must NOT drop it (that would
  // 404 a just-published post until the rebuild). Only visibility/gating drops KV.
  if ((hasDraft && body.draft) || hasGateable) await kvUnpublish(env, slug);
  return json({ ok: true, slug,
    ...(hasDraft ? { draft: body.draft } : {}),
    ...(hasGateable ? { gateable: body.gateable } : {}),
    ...(hasSeries ? { series: body.series } : {}) });
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
  let del;
  try {
    del = await fetch(fileApi(env, slug), {
      method: 'DELETE',
      headers: ghHeaders(env),
      body: JSON.stringify({ message: `Delete post: ${slug}`, branch, sha: file.sha }),
    });
  } catch (e) {
    return json({ error: 'Delete failed: ' + String((e && e.message) || e) }, 502);
  }
  if (!del.ok) return json({ error: 'GitHub delete failed', detail: (await del.text()).slice(0, 300) }, 502);

  await kvUnpublish(env, slug);
  return json({ ok: true, slug, deleted: true });
}
