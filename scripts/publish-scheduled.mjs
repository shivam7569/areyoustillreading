/**
 * scripts/publish-scheduled.mjs — publish any post whose scheduled time has passed.
 *
 * A SCHEDULED post is `draft: true` + `publishAt: <ISO>` in its frontmatter (written
 * by the Studio's publish sheet). This script — run on a cron by
 * .github/workflows/scheduled-publish.yml — scans the content collection and, for
 * every scheduled post now due, flips `draft: false` and removes the `publishAt`
 * line. The workflow then commits the change, which triggers the normal Cloudflare
 * Pages rebuild, so the post goes live. Idempotent: nothing due => no writes.
 *
 * Deliberately dependency-free (Node built-ins only) and line-based on the exact
 * frontmatter shapes this repo emits — it never reformats a file it isn't publishing.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DIR = 'src/content/blog';
const now = Date.now();
let changed = 0;

const files = (await readdir(DIR)).filter((f) => f.endsWith('.md'));
for (const f of files) {
  const p = path.join(DIR, f);
  const raw = await readFile(p, 'utf8');
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) continue;
  const fm = fmMatch[1];

  const draftLine = fm.match(/^draft:\s*(true|false)\s*$/m);
  const paLine = fm.match(/^publishAt:\s*["']?([^"'\r\n]+?)["']?\s*$/m);
  if (!draftLine || draftLine[1] !== 'true' || !paLine) continue; // not a scheduled post

  const when = Date.parse(paLine[1]);
  if (!Number.isFinite(when)) { console.warn(`! ${f}: unparseable publishAt "${paLine[1]}" — skipping`); continue; }
  if (when > now) continue; // not due yet

  // Due — publish it: draft:false and drop the publishAt line, touching nothing else.
  const newFm = fm
    .replace(/^draft:\s*true\s*$/m, 'draft: false')
    .replace(/^publishAt:\s*.*\r?\n?/m, '');
  await writeFile(p, raw.replace(fm, newFm), 'utf8');
  changed++;
  console.log(`✓ Published scheduled post: ${f} (was due ${paLine[1]})`);
}

console.log(`changed=${changed}`);
