/*
 * POST /api/publish — commit a post's Markdown file to the GitHub repo so the
 * Cloudflare Pages Git-integration rebuilds and deploys it (Option B publishing).
 *
 * WHAT / RESPONSIBILITY
 *   A single Cloudflare Pages Function (deployed from this file's path as the route
 *   /api/publish). Its one job: take a { slug, content } pair from an authenticated
 *   admin, authenticate the caller, and write src/content/blog/<slug>.md into the
 *   GitHub repo via the GitHub Contents API. It does NOT render or deploy anything
 *   itself — the commit is the whole product.
 *
 * WHERE IT SITS (end-to-end publish pipeline)
 *   Admin editor (src/pages/admin/editor.astro, the sign-in-gated "publish" modal)
 *     -> POST /api/publish with the author's Supabase access token in the
 *        Authorization header and the built Markdown (frontmatter + body) as `content`
 *     -> THIS function commits src/content/blog/<slug>.md to GitHub (create or update)
 *     -> Cloudflare Pages' GitHub Git-integration sees the push and triggers a fresh
 *        static Astro build, which turns the .md into a real published page.
 *   So this file is the ONE bridge between the live client-side editor and the
 *   git-backed content collection Astro builds from. The rebuild is async and owned
 *   by Cloudflare — a 200 here means "committed", NOT "already live" (build lag of
 *   ~1-2 min before the post appears).
 *
 * WHO DEPENDS ON IT
 *   Only the admin editor's publish modal (src/pages/admin/editor.astro) calls this.
 *   It is not a general content API — the slug maps directly to a file in Astro's
 *   `blog` content collection (src/content/config.* schema governs valid frontmatter).
 *
 * SECURITY (critical — this endpoint can write to the source repo)
 *   Because it holds GITHUB_TOKEN (repo write), it MUST NOT be open. Every request is
 *   gated by a valid Supabase session (Authorization: Bearer <access_token>) that must
 *   belong to a row in public.admins. No publish secret is ever typed by the author or
 *   embedded in the client — auth is the author's normal one-time Supabase sign-in.
 *   The token is validated by Supabase (GET /auth/v1/user), never decoded here, so we
 *   never trust client-supplied identity. The admin lookup uses the service-role key
 *   because public.admins intentionally has no RLS SELECT policy (not readable by
 *   ordinary users). Failing to configure Supabase env => 500 and refuse (fail closed).
 *
 * GOTCHAS
 *   - Create vs. update: GitHub's Contents API requires the existing blob `sha` to
 *     overwrite a file; a missing file (404) means create with no sha. We look it up
 *     first (see below). A concurrent edit can make the sha stale => GitHub 409 =>
 *     surfaced here as a 502 "GitHub commit failed".
 *   - Base64: content must be base64 of UTF-8 bytes; plain btoa() corrupts non-Latin1
 *     characters, hence toBase64Utf8() (encode to bytes first).
 *   - Slug is validated against a strict pattern before it becomes a file path, so a
 *     caller cannot traverse out of src/content/blog/ or inject odd path characters.
 *
 * Env (Cloudflare Pages project settings):
 *   GITHUB_TOKEN              — fine-grained PAT with Contents: write on the repo
 *   SUPABASE_URL              — Supabase project base URL (auth + admin check)
 *   SUPABASE_SERVICE_ROLE_KEY — service role (validates token, reads public.admins)
 *   GITHUB_REPO               — "owner/name" (default: shivam7569/areyoustillreading)
 *   GITHUB_BRANCH             — branch to commit to (default: main -> production build)
 */
// Shared, fail-closed admin gate (validate Supabase Bearer token → confirm the
// user has a public.admins row via the service-role key). Extracted so every
// admin endpoint uses the exact same boundary. See lib/require-admin.js.
import { requireAdmin } from '../../lib/require-admin.js';
// Chunked UTF-8 base64 (shared) — a plain String.fromCharCode(...bytes) spread throws
// RangeError on large posts (e.g. embedded data-URI images); see lib/base64.js.
import { toBase64Utf8 } from '../../lib/base64.js';

// Tiny helper to return a JSON Response with the right content-type. Every exit
// path (success and error) goes through this so the client always gets JSON.
const JSON_HEADERS = { 'content-type': 'application/json' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

export async function onRequestPost({ request, env }) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  // slug -> the .md filename; content -> full Markdown (frontmatter + body) for the
  // durable git commit; html -> the pre-assembled full page HTML (built in the editor
  // from the current /post-shell + the rendered body) for the instant KV overlay.
  const { slug, content, html, title, description, pubDate, draft } = payload || {};

  // --- Auth: caller must be a signed-in admin (Supabase session) ------------
  // One shared, fail-closed gate for every admin endpoint (see lib/require-admin.js).
  // Wrapped so any unexpected throw here returns a readable JSON error instead of a
  // bare 502 (the auth step runs before the main try/catch below).
  let gate;
  try {
    gate = await requireAdmin(request, env);
  } catch (e) {
    return json({ error: 'Auth check failed: ' + String((e && e.message) || e) }, 500);
  }
  if (!gate.ok) return json({ error: gate.error }, gate.status);

  // --- Validate -------------------------------------------------------------
  if (typeof slug !== 'string' || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug)) {
    return json({ error: 'Invalid slug (use lowercase letters, digits, hyphens)' }, 400);
  }
  if (typeof content !== 'string' || !content.trim()) return json({ error: 'Missing content' }, 400);

  const token = env.GITHUB_TOKEN;
  if (!token) return json({ error: 'Server not configured (GITHUB_TOKEN)' }, 500);
  const repo = env.GITHUB_REPO || 'shivam7569/areyoustillreading';
  const branch = env.GITHUB_BRANCH || 'main';
  // Target file inside Astro's `blog` content collection; slug was strictly validated
  // above, so it is safe to interpolate into the path (no traversal / odd chars).
  const path = `src/content/blog/${slug}.md`;
  const api = `https://api.github.com/repos/${repo}/contents/${path}`;
  // Headers required by the GitHub REST API: a User-Agent is mandatory or GitHub 403s,
  // and pinning X-GitHub-Api-Version guards against future breaking changes.
  const gh = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'aysr-publisher',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  try {
    // Look up the current file: 200 => it exists, capture its blob `sha` (needed to
    // overwrite); 404 => new file, leave sha undefined; anything else => real GitHub
    // error, bail out as 502 (upstream failure) with a truncated detail for debugging.
    let sha;
    const head = await fetch(`${api}?ref=${encodeURIComponent(branch)}`, { headers: gh });
    if (head.status === 200) sha = (await head.json()).sha;
    else if (head.status !== 404) {
      return json({ error: 'GitHub lookup failed', status: head.status, detail: (await head.text()).slice(0, 300) }, 502);
    }

    // Single PUT creates or updates the file (commit message reflects which). Including
    // `sha` turns it into an overwrite; omitting it creates. This one call is the push
    // that Cloudflare Pages' Git integration observes and rebuilds from.
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
    // Success payload for the editor: `updated` distinguishes edit vs. first publish,
    // `commit` is the new commit SHA, `fileUrl` links to the file on GitHub. Remember:
    // this means "committed", not "deployed" — the Pages rebuild happens afterward.
    const data = await put.json();

    // INSTANT PUBLISH: write the pre-assembled full-page HTML to KV so the
    // /blog/<slug> overlay (functions/blog/_middleware.js) serves it in seconds —
    // no waiting for the git-commit rebuild. `publishedAt` (server clock) is what the
    // overlay's staleness gate compares against the deployment build time, so this
    // copy is served only until the rebuild lands. Best-effort: a KV failure still
    // leaves the post committed (live after the rebuild ~1-2 min), so we report the
    // outcome via `instant` rather than failing the publish.
    let instant = false;
    if (env.POSTS_HTML && typeof html === 'string' && html.trim()) {
      const publishedAt = Date.now();
      try {
        // `draft` lets the /blog overlay skip serving a draft publicly (early-access
        // drafts are reachable only via a tokenized /early link — see functions/early.js).
        // TTL the instant copy: the git rebuild (~1-2 min) bakes the post in and the
        // staleness gate stops serving KV once builtAt passes publishedAt — so the entry
        // only needs to outlive the rebuild. Expiring it means later views KV-MISS and go
        // straight to the static page WITHOUT the overlay's build-meta.json subrequest
        // (perf). 1 hour is a wide margin over a normal build (guards a slow CF queue).
        await env.POSTS_HTML.put(slug, JSON.stringify({ html, publishedAt, draft: !!draft }), { expirationTtl: 3600 });
        instant = true;
        // Maintain a small recent-posts index so the /blog listing overlay can show
        // this post immediately too (the static listing only refreshes on rebuild).
        // Skip drafts — they must not appear in the public listing. Best-effort.
        if (!draft && typeof title === 'string' && title) {
          try {
            const idxRaw = await env.POSTS_HTML.get('__index');
            let idx = idxRaw ? JSON.parse(idxRaw) : [];
            if (!Array.isArray(idx)) idx = [];
            idx = idx.filter((p) => p && p.slug !== slug); // de-dupe this slug
            idx.unshift({ slug, title, description: description || '', pubDate: pubDate || '', publishedAt });
            await env.POSTS_HTML.put('__index', JSON.stringify(idx.slice(0, 30)));
          } catch (e) { /* index update is best-effort */ }
        } else if (draft) {
          // A post re-saved as draft should drop out of the listing index.
          try {
            const idxRaw = await env.POSTS_HTML.get('__index');
            const idx = idxRaw ? JSON.parse(idxRaw) : [];
            if (Array.isArray(idx)) await env.POSTS_HTML.put('__index', JSON.stringify(idx.filter((p) => p && p.slug !== slug)));
          } catch (e) {}
        }
      } catch (e) { /* committed but not instant */ }
    }

    return json({
      ok: true,
      path,
      branch,
      updated: Boolean(sha),
      instant,
      commit: data.commit?.sha,
      fileUrl: data.content?.html_url,
    });
  } catch (e) {
    // Network/unexpected failure (fetch threw, JSON parse, etc.) -> generic 500.
    return json({ error: String((e && e.message) || e) }, 500);
  }
}
