/**
 * scripts/loadtest/probe.mjs — measure the read paths the schema + indexes serve.
 * ============================================================================
 * Runs the queries the public site will lean on (global feed, per-author, tag
 * filter, series join, search-shape) against the seeded data and reports
 * p50 / p95 / max latency, so we can see the indexes hold up at volume BEFORE any
 * serving layer exists. (RLS-path load testing — signing in as dummy authors and
 * hitting PostgREST — arrives in Phase 2 when `content` is exposed.)
 *
 *   node scripts/loadtest/probe.mjs --runs 60
 */
import { getPool, args } from '../_shared.mjs';

const RUNS = Number(args.runs ?? 60);

async function time(pool, sql, params = []) {
  const ts = [];
  for (let i = 0; i < RUNS; i++) {
    const t = process.hrtime.bigint();
    await pool.query(sql, params);
    ts.push(Number(process.hrtime.bigint() - t) / 1e6);
  }
  ts.sort((a, b) => a - b);
  const q = (p) => ts[Math.min(ts.length - 1, Math.floor(p * ts.length))];
  return { p50: q(0.5), p95: q(0.95), max: ts[ts.length - 1] };
}
const row = (name, r) => `  ${name.padEnd(26)} p50 ${r.p50.toFixed(1).padStart(6)}ms   p95 ${r.p95.toFixed(1).padStart(6)}ms   max ${r.max.toFixed(1).padStart(6)}ms`;

async function main() {
  const pool = getPool();
  try {
    const counts = await pool.query(`select
      (select count(*) from content.posts)    as posts,
      (select count(*) from content.posts where status='published') as published,
      (select count(*) from content.series)   as series,
      (select count(*) from content.profiles) as profiles`);
    const c = counts.rows[0];
    console.log(`Data: ${c.posts} posts (${c.published} published) · ${c.series} series · ${c.profiles} profiles · ${RUNS} runs/query\n`);

    const anAuthor = (await pool.query(`select author_id from content.posts limit 1`)).rows[0]?.author_id;
    const aSeries = (await pool.query(`select id from content.series limit 1`)).rows[0]?.id;

    console.log(row('global feed (limit 20)', await time(pool,
      `select id, slug, title, pub_date, tags from content.posts
       where status='published' and visibility='public' and deleted_at is null
       order by pub_date desc limit 20`)));

    console.log(row('feed page 2 (keyset)', await time(pool,
      `select id, slug, title, pub_date from content.posts
       where status='published' and visibility='public' and deleted_at is null
         and pub_date < now() - interval '30 days'
       order by pub_date desc limit 20`)));

    if (anAuthor) console.log(row('author page (limit 20)', await time(pool,
      `select id, slug, title, pub_date from content.posts
       where author_id=$1 and status='published' and deleted_at is null
       order by pub_date desc limit 20`, [anAuthor])));

    console.log(row('tag filter (limit 20)', await time(pool,
      `select id, slug, title from content.posts
       where status='published' and tags @> $1 and deleted_at is null
       order by pub_date desc limit 20`, [['ml']])));

    if (aSeries) console.log(row('series → posts (join)', await time(pool,
      `select p.slug, p.title, sp.position from content.series s
       join content.series_posts sp on sp.series_id = s.id
       join content.posts p on p.id = sp.post_id
       where s.id=$1 order by sp.position`, [aSeries])));

    console.log(row('search shape (ILIKE)', await time(pool,
      `select id, slug, title from content.posts
       where status='published' and (title ilike $1 or body_text ilike $1)
       order by pub_date desc limit 20`, ['%retrieval%'])));

    console.log('\nNote: this measures raw query/index latency (owner connection, RLS bypassed).');
    console.log('Phase 2 adds an RLS-path probe (signed-in authors over PostgREST) once `content` is exposed.');
  } finally {
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
