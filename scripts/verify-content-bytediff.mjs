/**
 * scripts/verify-content-bytediff.mjs — the Phase-1 acceptance gate.
 * ============================================================================
 * Proves the shadow backfill lost nothing and renders identically to the build:
 *   (a) LOSSLESS: content.posts.source_raw is byte-identical to the .md on disk.
 *   (b) RENDER:   for each published post, renderPostBody(body_md) === body_html
 *                 (the exact build pipeline).
 *   (c) NO CHANGE: Phase 1 edits no src/**, functions/**, or config — so the
 *                  built site is unchanged by construction. This script prints the
 *                  reminder; confirm with:  git diff --stat origin/main -- src functions astro.config.mjs public
 *
 * Exits non-zero on any mismatch.
 *   node scripts/verify-content-bytediff.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { getPool, resolveOwner, splitMd, ROOT } from './_shared.mjs';
import { renderPostBody } from '../src/lib/render-post.mjs';

async function main() {
  const pool = getPool();
  let fails = 0;
  try {
    const { ownerId } = await resolveOwner(pool);
    const { rows } = await pool.query(
      `select slug, status, source_path, source_raw, body_md, body_html
       from content.posts where author_id = $1 order by slug`, [ownerId],
    );
    if (!rows.length) { console.error('No content.posts rows for the owner — run backfill first.'); process.exit(1); }

    console.log(`Verifying ${rows.length} posts…\n`);
    for (const r of rows) {
      // (a) losslessness
      const disk = fs.existsSync(path.join(ROOT, r.source_path)) ? fs.readFileSync(path.join(ROOT, r.source_path), 'utf8') : null;
      if (disk === null) { console.error(`  ✗ ${r.slug}: source file missing at ${r.source_path}`); fails++; continue; }
      if (disk !== r.source_raw) { console.error(`  ✗ ${r.slug}: source_raw differs from disk (backfill not lossless)`); fails++; continue; }

      // (b) render equivalence (published only)
      if (r.status === 'published') {
        const rerendered = await renderPostBody(splitMd(r.source_raw).body);
        if (rerendered !== r.body_html) { console.error(`  ✗ ${r.slug}: body_html != renderPostBody(source) — pipeline drift`); fails++; continue; }
      }
      console.log(`  ✓ ${r.slug}${r.status !== 'published' ? ` (${r.status})` : ''}`);
    }

    console.log(`\n${fails === 0 ? '✓ PASS' : `✗ FAIL (${fails})`} — lossless + render-identical.`);
    console.log('  (c) Confirm no site change:  git diff --stat origin/main -- src functions astro.config.mjs public');
    if (fails) process.exit(1);
  } finally {
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
