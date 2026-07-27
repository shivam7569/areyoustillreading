/**
 * lib/list-posts.js — read the LIVE post catalog for the admin dashboard.
 * ============================================================================
 * WHY THIS EXISTS
 *   The public site knows its posts via getCollection('blog'), but that is
 *   BUILD-TIME data baked into static HTML — stale the moment anything changes.
 *   The dashboard's Posts manager and Home overview need the CURRENT set of
 *   posts, drafts included, at request time. The only runtime source that can
 *   enumerate every .md (including drafts, which are excluded from KV/__index)
 *   is the GitHub Contents API — the same repo /api/publish commits to. This
 *   module lists those files and parses each one's frontmatter.
 *
 * SHARED BY: functions/api/admin/posts.js and functions/api/admin/overview.js
 * (so the "list posts" logic and its frontmatter parsing live in exactly one place).
 *
 * ENV: GITHUB_TOKEN (Contents: read), GITHUB_REPO ("owner/name"), GITHUB_BRANCH.
 * ============================================================================
 */

import { fromBase64Utf8 } from './base64.js';

/**
 * Minimal YAML frontmatter parser scoped to the shapes this repo actually emits:
 *   key: "json-quoted"  |  key: bare value  |  key: true/false  |
 *   key: ["inline","array"]  |  a block list of "- item" lines.
 * Anything it can't understand is skipped, degrading to sensible defaults rather
 * than throwing — a single odd post must never break the whole listing.
 */
export function parseFrontmatter(raw) {
  const out = {};
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw || '');
  if (!m) return out;
  const lines = m[1].split(/\r?\n/);
  let lastArrayKey = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    // Block-list continuation: "  - item" appended to the previous key.
    const li = /^\s*-\s+(.*)$/.exec(line);
    if (li && lastArrayKey) {
      out[lastArrayKey].push(coerceScalar(li[1].trim()));
      continue;
    }
    const kv = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1];
    const val = kv[2].trim();
    lastArrayKey = null;
    if (val === '') {
      // Possibly the header of a block list; prime an array for following "- " lines.
      out[key] = [];
      lastArrayKey = key;
    } else if (val.startsWith('[')) {
      try {
        out[key] = JSON.parse(val);
      } catch {
        out[key] = [];
      }
    } else {
      out[key] = coerceScalar(val);
    }
  }
  return out;
}

function coerceScalar(val) {
  if (val === 'true') return true;
  if (val === 'false') return false;
  if (val.startsWith('"')) {
    try {
      return JSON.parse(val);
    } catch {
      return val.replace(/^"|"$/g, '');
    }
  }
  if (val.startsWith("'")) return val.replace(/^'|'$/g, '');
  return val;
}

/** Normalize a pubDate frontmatter value to a YYYY-MM-DD string for display/sort. */
function toDateStr(v) {
  if (!v) return '';
  const s = String(v);
  const d = s.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : s;
}

/**
 * List every post in the content collection with parsed frontmatter.
 * @returns {Promise<Array<{slug,sha,title,description,pubDate,updatedDate,tags,draft,gateable,preview}>>}
 * Sorted newest-first by pubDate. Throws only on a hard GitHub failure (non-404).
 */
export async function listPosts(env) {
  const repo = env.GITHUB_REPO || 'shivam7569/areyoustillreading';
  const branch = env.GITHUB_BRANCH || 'main';
  const gh = {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'aysr-admin',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const dirRes = await fetch(
    `https://api.github.com/repos/${repo}/contents/src/content/blog?ref=${encodeURIComponent(branch)}`,
    { headers: gh },
  );
  if (dirRes.status === 404) return []; // no posts dir yet
  if (!dirRes.ok) throw new Error(`GitHub listing failed (${dirRes.status})`);
  const entries = await dirRes.json();
  const files = Array.isArray(entries)
    ? entries.filter((f) => f && f.type === 'file' && /\.md$/.test(f.name))
    : [];

  // Fetch each file's content (for frontmatter) in parallel. GitHub returns the
  // blob base64-encoded on the Contents API item URL (which already carries ?ref).
  const posts = await Promise.all(
    files.map(async (f) => {
      const slug = f.name.replace(/\.md$/, '');
      let raw = '';
      try {
        const r = await fetch(f.url, { headers: gh });
        if (r.ok) {
          const j = await r.json();
          raw = j && j.content ? fromBase64Utf8(j.content) : '';
        }
      } catch {
        /* leave raw empty → post still listed with slug as title */
      }
      const fm = parseFrontmatter(raw);
      return {
        slug,
        sha: f.sha,
        title: typeof fm.title === 'string' && fm.title ? fm.title : slug,
        description: typeof fm.description === 'string' ? fm.description : '',
        pubDate: toDateStr(fm.pubDate),
        updatedDate: toDateStr(fm.updatedDate),
        tags: Array.isArray(fm.tags) ? fm.tags.map(String) : [],
        draft: fm.draft === true,
        gateable: fm.gateable === true,
        preview: typeof fm.preview === 'string' ? fm.preview : '',
      };
    }),
  );

  posts.sort((a, b) => (b.pubDate || '').localeCompare(a.pubDate || ''));
  return posts;
}
