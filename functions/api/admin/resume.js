/**
 * /api/admin/resume — manage the resume/CV from the Studio. All admin-gated.
 * ----------------------------------------------------------------------------
 *   GET                      → load src/data/resume.json (parsed) + its sha,
 *                              plus whether public/resume.pdf currently exists.
 *   POST { content }         → commit src/data/resume.json (the full model).
 *   POST { action:'pdf',
 *          pdfBase64, pdfName } → commit public/resume.pdf (the served download).
 *   DELETE ?pdf              → remove public/resume.pdf.
 *
 * Persistence is the SAME model posts use: a GitHub Contents-API commit that
 * triggers the Cloudflare rebuild (~1 min to live). No Supabase, no KV — the
 * resume changes infrequently, so build-time rendering (src/pages/resume.astro
 * reads the JSON) keeps the public page fully static/SEO/print-friendly.
 *
 * SECURITY: requireAdmin() gates every method (same boundary as every other
 * /api/admin/* endpoint); GITHUB_TOKEN never reaches the client. Uploads are
 * validated as real PDFs under a size cap before they are committed.
 */
import { requireAdmin, json } from '../../../lib/require-admin.js';
import { toBase64Utf8, fromBase64Utf8 } from '../../../lib/base64.js';

const RESUME_JSON = 'src/data/resume.json';
const RESUME_PDF = 'public/resume.pdf';
const MAX_PDF_BYTES = 8 * 1024 * 1024; // 8 MB — a CV PDF is far smaller

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

// Look up a repo file. Returns { sha, base64 } or null (404). Throws on hard error.
// `base64` is GitHub's stored content (new-line-wrapped base64); callers that need
// text decode it, callers that only need the sha ignore it.
async function getFile(env, path) {
  const { branch } = repoInfo(env);
  const r = await fetch(`${contentsApi(env, path)}?ref=${encodeURIComponent(branch)}`, { headers: ghHeaders(env) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub lookup failed (${r.status})`);
  const j = await r.json();
  return { sha: j.sha, base64: j.content || '', size: j.size || 0 };
}

// Commit a file (create or update). `contentBase64` is raw base64 of the bytes.
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

// ---- GET: load the model + PDF presence ------------------------------------
export async function onRequestGet({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (!gate.ok) return json({ error: gate.error }, gate.status);

  let file, pdf;
  try {
    file = await getFile(env, RESUME_JSON);
    pdf = await getFile(env, RESUME_PDF);
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 502);
  }
  if (!file) return json({ error: 'resume.json not found in the repo' }, 404);

  let content;
  try {
    content = JSON.parse(fromBase64Utf8(file.base64));
  } catch {
    return json({ error: 'resume.json is not valid JSON' }, 502);
  }
  return json({
    content,
    sha: file.sha,
    pdf: pdf ? { exists: true, size: pdf.size } : { exists: false },
  });
}

// ---- POST: save content, OR upload a PDF -----------------------------------
export async function onRequestPost({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (!gate.ok) return json({ error: gate.error }, gate.status);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  // --- PDF upload ---
  if (body && body.action === 'pdf') {
    const b64 = typeof body.pdfBase64 === 'string' ? body.pdfBase64.trim() : '';
    const name = String(body.pdfName || 'resume.pdf');
    if (!b64) return json({ error: 'No PDF data' }, 400);
    // Size cap (base64 → bytes ≈ len * 3/4).
    if (b64.length * 0.75 > MAX_PDF_BYTES) return json({ error: 'PDF too large (max 8 MB)' }, 400);
    // Validate it really is a PDF: the first bytes must be "%PDF".
    let head = '';
    try {
      head = atob(b64.slice(0, 8));
    } catch {
      return json({ error: 'PDF data is not valid base64' }, 400);
    }
    if (!head.startsWith('%PDF')) return json({ error: 'That file is not a PDF' }, 400);

    let existing;
    try {
      existing = await getFile(env, RESUME_PDF);
    } catch (e) {
      return json({ error: String((e && e.message) || e) }, 502);
    }
    try {
      await putFile(env, RESUME_PDF, {
        message: `chore(resume): upload PDF (${name})`,
        contentBase64: b64,
        sha: existing ? existing.sha : undefined,
      });
    } catch (e) {
      return json({ error: String((e && e.message) || e) }, 502);
    }
    return json({ ok: true, pdf: { exists: true, name } });
  }

  // --- content save ---
  const content = body && body.content;
  if (!content || typeof content !== 'object' || Array.isArray(content) || !content.header) {
    return json({ error: 'Invalid resume content' }, 400);
  }
  let existing;
  try {
    existing = await getFile(env, RESUME_JSON);
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 502);
  }
  const serialized = JSON.stringify(content, null, 2) + '\n';
  try {
    await putFile(env, RESUME_JSON, {
      message: 'chore(resume): update from Studio',
      contentBase64: toBase64Utf8(serialized),
      sha: existing ? existing.sha : undefined,
    });
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 502);
  }
  return json({ ok: true });
}

// ---- DELETE ?pdf: remove the served PDF ------------------------------------
export async function onRequestDelete({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (!gate.ok) return json({ error: gate.error }, gate.status);
  if (!new URL(request.url).searchParams.has('pdf')) return json({ error: 'Nothing to delete' }, 400);

  let existing;
  try {
    existing = await getFile(env, RESUME_PDF);
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 502);
  }
  if (!existing) return json({ ok: true, pdf: { exists: false } }); // already gone
  try {
    await deleteFile(env, RESUME_PDF, { message: 'chore(resume): remove PDF', sha: existing.sha });
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 502);
  }
  return json({ ok: true, pdf: { exists: false } });
}
