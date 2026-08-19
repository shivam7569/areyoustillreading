/**
 * scripts/backfill-content.mjs — Phase 1 shadow-load.
 * ============================================================================
 * Reads the existing Markdown posts + series.json + fields.json and loads them
 * into the `content.*` tables owned by the site owner. Renders each published
 * post's body through the SAME pipeline as the build (src/lib/render-post.mjs)
 * so content.posts.body_html matches what the site serves. Idempotent: it clears
 * the owner's existing backfilled rows first, then reloads — safe to re-run.
 *
 * Nothing on the live site changes; these rows are pure shadow. Prove that with
 * scripts/verify-content-bytediff.mjs afterwards.
 *
 *   node scripts/backfill-content.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { getPool, resolveOwner, splitMd, textAndReadingMin, slugify, ROOT } from './_shared.mjs';
import { parseFrontmatter } from '../lib/list-posts.js';
import { renderPostBody } from '../src/lib/render-post.mjs';
import seriesData from '../src/data/series.json' with { type: 'json' };
import fieldsData from '../src/data/fields.json' with { type: 'json' };
import siteData from '../src/data/site.json' with { type: 'json' };

const BLOG_DIR = path.join(ROOT, 'src', 'content', 'blog');

function statusOf(fm) {
  if (fm.draft === true) {
    if (fm.publishAt && Date.parse(fm.publishAt) > Date.now()) return 'scheduled';
    return 'draft';
  }
  return 'published';
}
const dateOrNull = (v) => { if (!v) return null; const t = Date.parse(String(v)); return Number.isNaN(t) ? null : new Date(t).toISOString(); };
const numOrNull = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

async function main() {
  const pool = getPool();
  try {
    const { ownerId, penName } = await resolveOwner(pool);
    const displayPen = penName || (siteData.post && siteData.post.author) || 'gradghost';
    console.log(`Owner ${ownerId}  ·  pen name "${displayPen}"`);

    // Owner profile (direct upsert; the connection role is privileged).
    const handleRow = await pool.query('select content.unique_handle($1) as h', [displayPen]);
    const existing = await pool.query('select handle from content.profiles where id = $1', [ownerId]);
    const ownerHandle = existing.rows[0]?.handle || handleRow.rows[0].h;
    await pool.query(
      `insert into content.profiles (id, handle, pen_name, role, can_publish, status)
       values ($1,$2,$3,'author',true,'active')
       on conflict (id) do update set pen_name = excluded.pen_name, role = 'author', can_publish = true, status = 'active', updated_at = now()`,
      [ownerId, ownerHandle, displayPen],
    );
    console.log(`Owner profile @${ownerHandle}`);

    // Clean reload of the owner's content (idempotent). Joins cascade from posts/series/fields.
    await pool.query('delete from content.posts  where author_id = $1', [ownerId]);
    await pool.query('delete from content.series where owner_id  = $1', [ownerId]);
    await pool.query('delete from content.fields where owner_id  = $1', [ownerId]);

    // ── posts ────────────────────────────────────────────────────────────────
    const files = fs.existsSync(BLOG_DIR) ? fs.readdirSync(BLOG_DIR).filter((f) => f.endsWith('.md')) : [];
    const postIdBySlug = new Map();
    for (const file of files) {
      const slug = file.replace(/\.md$/, '');
      const raw = fs.readFileSync(path.join(BLOG_DIR, file), 'utf8');
      const fm = parseFrontmatter(raw);
      const { body } = splitMd(raw);
      const status = statusOf(fm);
      let bodyHtml = null, bodyText = null, readingMin = null, publishedMd = null, publishedAt = null, version = 0;
      if (status === 'published') {
        bodyHtml = await renderPostBody(body);
        const t = textAndReadingMin(bodyHtml);
        bodyText = t.text; readingMin = t.readingMin; publishedMd = body; publishedAt = dateOrNull(fm.pubDate) || new Date().toISOString(); version = 1;
      }
      const { rows } = await pool.query(
        `insert into content.posts
           (author_id, slug, title, description, pub_date, updated_date, publish_at, tags, author_byline,
            gateable, preview, status, visibility, body_md, body_html, body_text, reading_min, current_version,
            published_md, published_at, source_raw, source_path)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'public',$13,$14,$15,$16,$17,$18,$19,$20,$21)
         returning id`,
        [
          ownerId, slug,
          typeof fm.title === 'string' ? fm.title : slug,
          typeof fm.description === 'string' ? fm.description : '',
          dateOrNull(fm.pubDate), dateOrNull(fm.updatedDate), dateOrNull(fm.publishAt),
          Array.isArray(fm.tags) ? fm.tags.map(String) : [],
          typeof fm.author === 'string' ? fm.author : '',
          fm.gateable === true, typeof fm.preview === 'string' ? fm.preview : '',
          status, body, bodyHtml, bodyText, readingMin, version, publishedMd, publishedAt,
          raw, `src/content/blog/${file}`,
        ],
      );
      postIdBySlug.set(slug, { id: rows[0].id, fm });
    }
    console.log(`Posts: ${postIdBySlug.size}`);

    // ── series (union of series.json + every frontmatter-referenced series) ────
    const seriesById = new Map();          // slug -> id
    const defsBySlug = new Map((seriesData.series || []).map((s) => [s.slug, s]));
    const referenced = new Set([...defsBySlug.keys()]);
    for (const { fm } of postIdBySlug.values()) if (typeof fm.series === 'string' && fm.series) referenced.add(fm.series);
    for (const sslug of referenced) {
      const def = defsBySlug.get(sslug) || {};
      // Title: series.json title, else the first post's seriesTitle, else prettified slug.
      let title = def.title || '';
      if (!title) for (const { fm } of postIdBySlug.values()) if (fm.series === sslug && fm.seriesTitle) { title = fm.seriesTitle; break; }
      if (!title) title = sslug.replace(/[-_]+/g, ' ');
      const status = ['in-progress', 'complete', 'paused'].includes(def.status) ? def.status : null;
      const { rows } = await pool.query(
        `insert into content.series (owner_id, slug, title, summary, total, status, planned)
         values ($1,$2,$3,$4,$5,$6,$7) returning id`,
        [ownerId, sslug, title, def.summary || '', numOrNull(def.total), status, Array.isArray(def.planned) ? def.planned.map(String) : []],
      );
      seriesById.set(sslug, rows[0].id);
    }
    console.log(`Series: ${seriesById.size}`);

    // ── series_posts (membership + order from frontmatter) ─────────────────────
    let links = 0;
    for (const [slug, { id, fm }] of postIdBySlug) {
      if (typeof fm.series === 'string' && seriesById.has(fm.series)) {
        await pool.query(
          `insert into content.series_posts (series_id, post_id, position) values ($1,$2,$3)
           on conflict (series_id, post_id) do update set position = excluded.position`,
          [seriesById.get(fm.series), id, numOrNull(fm.seriesOrder) ?? 0],
        );
        links++;
      }
    }
    console.log(`Series memberships: ${links}`);

    // ── fields + field_series (from fields.json; skip members that don't exist) ─
    let fieldCount = 0, fieldLinks = 0;
    for (const f of fieldsData.fields || []) {
      const { rows } = await pool.query(
        `insert into content.fields (owner_id, slug, title, summary, mark) values ($1,$2,$3,$4,$5) returning id`,
        [ownerId, f.slug, f.title || f.slug, f.summary || '', /^(0[1-9]|10)$/.test(f.mark) ? f.mark : '01'],
      );
      fieldCount++;
      let pos = 0;
      for (const member of f.series || []) {
        const sid = seriesById.get(member.slug);
        if (!sid) continue; // member series has no published posts / isn't defined → skip (mirrors the public rule)
        await pool.query(
          `insert into content.field_series (field_id, series_id, position, note) values ($1,$2,$3,$4)
           on conflict (field_id, series_id) do update set position = excluded.position, note = excluded.note`,
          [rows[0].id, sid, pos++, member.note || ''],
        );
        fieldLinks++;
      }
    }
    console.log(`Fields: ${fieldCount}  ·  field memberships: ${fieldLinks}`);
    console.log('\nBackfill complete. Run: node scripts/verify-content-bytediff.mjs');
  } finally {
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
