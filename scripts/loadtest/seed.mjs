/**
 * scripts/loadtest/seed.mjs — generate dummy users + content for load testing.
 * ============================================================================
 * Creates dummy AUTHORS and READERS (real auth.users, via the Supabase Auth admin
 * API) and bulk content (profiles/posts/series/fields, via pg). Everything is
 * tagged so teardown is exact:
 *   - emails:   lt-author-<i>@loadtest.invalid / lt-reader-<j>@loadtest.invalid
 *   - handles:  lt-…            - post/series/field slugs: lt-…
 *
 * Auth users are created via the admin API (a few calls); content is bulk-inserted
 * over pg (fast), so you can push post volume high to exercise the schema + indexes
 * without thousands of auth calls.
 *
 *   node scripts/loadtest/seed.mjs --authors 10 --readers 40 --posts-per-author 50 --readers-interactions 200
 */
import { getPool, getAdminSupabase, LT, slugify, args } from '../_shared.mjs';

const AUTHORS = Number(args.authors ?? 10);
const READERS = Number(args.readers ?? 40);
const PPA = Number(args['posts-per-author'] ?? 50);
const INTERACTIONS = Number(args['readers-interactions'] ?? 200);

const LOREM = 'The quick brown fox tests the retrieval path. '.repeat(12);
const pick = (arr, i) => arr[i % arr.length];
const TAGS = [['ml', 'systems'], ['retrieval'], ['serving', 'latency'], ['eval'], ['meta']];

async function createUser(supa, pool, email, name) {
  const { data, error } = await supa.auth.admin.createUser({ email, password: LT.password, email_confirm: true, user_metadata: { name } });
  if (error) {
    if (String(error.message || '').match(/already|registered|exists/i)) {
      // Already exists from a prior run — look it up directly (no listUsers cap).
      const { rows } = await pool.query('select id from auth.users where lower(email) = lower($1) limit 1', [email]);
      if (rows[0]) return rows[0].id;
    }
    throw error;
  }
  return data.user.id;
}

async function main() {
  const pool = getPool();
  const supa = getAdminSupabase();
  const t0 = Date.now();
  try {
    console.log(`Seeding ${AUTHORS} authors × ${PPA} posts + ${READERS} readers…`);

    // Idempotent reseed: clear any prior lt- content first (joins cascade), so the
    // bulk inserts below never collide on a re-run.
    await pool.query(`delete from content.posts  where slug like '${LT.prefix}%'`);
    await pool.query(`delete from content.series where slug like '${LT.prefix}%'`);
    await pool.query(`delete from content.fields where slug like '${LT.prefix}%'`);

    // ── authors ────────────────────────────────────────────────────────────
    const authors = [];
    for (let i = 1; i <= AUTHORS; i++) {
      const email = `${LT.prefix}author-${i}@${LT.domain}`;
      const penName = `LT Author ${i}`;
      const id = await createUser(supa, pool, email, penName);
      const { rows } = await pool.query('select content.unique_handle($1) as h', [`${LT.prefix}${slugify(penName)}`]);
      await pool.query(
        `insert into content.profiles (id, handle, pen_name, role, can_publish, status)
         values ($1,$2,$3,'author',true,'active')
         on conflict (id) do update set role='author', can_publish=true, status='active', pen_name=excluded.pen_name`,
        [id, rows[0].h, penName],
      );
      authors.push({ id, handle: rows[0].h, i });
    }
    console.log(`  authors: ${authors.length}`);

    // ── bulk posts per author (multi-row inserts) ───────────────────────────
    let postCount = 0;
    for (const a of authors) {
      const vals = [], params = []; let n = 0;
      for (let k = 1; k <= PPA; k++) {
        const slug = `${LT.prefix}post-${a.i}-${k}`;
        const html = `<p>${LOREM}</p>`;
        const text = LOREM.trim();
        const days = (a.i * PPA + k) % 900;
        params.push(a.id, slug, `Load post ${a.i}.${k}`, `Synthetic post ${a.i}.${k} for load testing.`,
          new Date(Date.now() - days * 86400000).toISOString(), pick(TAGS, k), html, text, 3, 1);
        vals.push(`($${n + 1},$${n + 2},$${n + 3},$${n + 4},$${n + 5},'published','public',$${n + 6},'',$${n + 7},$${n + 8},$${n + 9},$${n + 10},now())`);
        n += 10;
      }
      await pool.query(
        `insert into content.posts
           (author_id, slug, title, description, pub_date, status, visibility, tags, author_byline, body_html, body_text, reading_min, current_version, published_at)
         values ${vals.join(',')}`,
        params,
      );
      postCount += PPA;
    }
    console.log(`  posts: ${postCount}`);

    // ── one series (first 5 posts) + one field per author ───────────────────
    for (const a of authors) {
      const sres = await pool.query(
        `insert into content.series (owner_id, slug, title, summary, total, status)
         values ($1,$2,$3,'A synthetic series.',5,'in-progress') returning id`,
        [a.id, `${LT.prefix}series-${a.i}`, `LT Series ${a.i}`],
      );
      const posts = await pool.query('select id from content.posts where author_id=$1 order by slug limit 5', [a.id]);
      let pos = 0;
      for (const p of posts.rows) await pool.query('insert into content.series_posts (series_id, post_id, position) values ($1,$2,$3)', [sres.rows[0].id, p.id, pos++]);
      // A field needs >=2 series to be public; one synthetic series each keeps this simple (field stays "not public yet").
      await pool.query(
        `insert into content.fields (owner_id, slug, title, summary, mark) values ($1,$2,$3,'A synthetic field.','0${(a.i % 9) + 1}')`,
        [a.id, `${LT.prefix}field-${a.i}`, `LT Field ${a.i}`],
      );
    }
    console.log(`  series + fields: ${authors.length} each`);

    // ── readers ─────────────────────────────────────────────────────────────
    const readers = [];
    for (let j = 1; j <= READERS; j++) {
      const email = `${LT.prefix}reader-${j}@${LT.domain}`;
      const id = await createUser(supa, pool, email, `LT Reader ${j}`);
      await pool.query(`insert into content.profiles (id, pen_name, role, status) values ($1,$2,'reader','active') on conflict (id) do nothing`, [id, `LT Reader ${j}`]);
      readers.push(id);
    }
    console.log(`  readers: ${readers.length}`);

    // ── reader interactions against lt- posts (exercise the reader tables) ───
    // These key off post SLUG (text), matching today's reader_progress/notes shape.
    const slugs = (await pool.query(`select slug from content.posts where slug like '${LT.prefix}%' order by random() limit 200`)).rows.map((r) => r.slug);
    let inter = 0;
    for (let n = 0; n < INTERACTIONS && slugs.length && readers.length; n++) {
      const uid = pick(readers, n), slug = pick(slugs, n * 7);
      await pool.query(
        `insert into public.reader_progress (user_id, post_slug, pct, read) values ($1,$2,$3,$4)
         on conflict (user_id, post_slug) do update set pct=excluded.pct, read=excluded.read, updated_at=now()`,
        [uid, slug, 20 + (n % 80), n % 3 === 0],
      );
      if (n % 4 === 0) {
        await pool.query(
          `insert into public.notes (post_id, user_id, author_name, body) values ($1,$2,'LT Reader',$3)
           on conflict (post_id, user_id) do update set body=excluded.body, updated_at=now()`,
          [slug, uid, `A synthetic note ${n}.`],
        );
      }
      inter++;
    }
    console.log(`  reader interactions: ${inter}`);

    console.log(`\nSeeded in ${((Date.now() - t0) / 1000).toFixed(1)}s. Probe with: node scripts/loadtest/probe.mjs`);
    console.log('Tear down with: node scripts/loadtest/teardown.mjs');
  } finally {
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
