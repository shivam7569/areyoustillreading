/**
 * scripts/loadtest/seed-analytics.mjs — a fake reading audience for the feed's
 * reading-shape curves. For every lt- post, generates read events whose read_pct
 * distribution produces a distinct retention SHAPE (holds to the end / drops off an
 * early cliff / loses readers midway / short-and-finished). Tagged by the lt- slug,
 * cleared by teardown.
 *
 *   node scripts/loadtest/seed-analytics.mjs
 */
import { getPool, LT } from '../_shared.mjs';

const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));
// Each returns one reader's read_pct (how far they got), shaped so the aggregate
// "readers remaining at x%" traces a recognisable curve.
const SHAPES = [
  () => clamp(100 - Math.pow(Math.random(), 3) * 34),                                              // holds to the end
  () => (Math.random() < 0.42 ? clamp(Math.random() * 18) : clamp(100 - Math.pow(Math.random(), 2) * 24)), // early cliff
  () => (Math.random() < 0.5 ? clamp(34 + Math.random() * 20) : clamp(100 - Math.random() * 16)),  // loses midway
  () => clamp(100 - Math.pow(Math.random(), 4) * 22),                                              // short, finished
];
const sid = () => 'lt-' + Math.random().toString(36).slice(2, 11);

async function main() {
  const pool = getPool();
  try {
    const posts = (await pool.query(`select slug from content.posts where slug like '${LT.prefix}%' order by slug`)).rows.map((r) => r.slug);
    if (!posts.length) { console.log('No lt- posts — run loadtest:seed first.'); return; }
    // Fresh: clear any prior fake reads so shapes don't compound on a re-run.
    await pool.query(`delete from public.analytics_events where session like 'lt-%' or slug like '${LT.prefix}%'`);

    let total = 0;
    for (let i = 0; i < posts.length; i++) {
      const slug = posts[i];
      const shape = SHAPES[i % SHAPES.length];
      const audience = 8 + Math.floor(Math.random() * 34);
      const vals = [], params = []; let n = 0;
      for (let k = 0; k < audience; k++) {
        params.push('read', '/blog/' + slug, slug, sid(), shape(), 20000 + Math.floor(Math.random() * 180000));
        vals.push(`(now() - (random()*45 || ' days')::interval, $${n + 1},$${n + 2},$${n + 3},$${n + 4},$${n + 5},$${n + 6})`);
        n += 6;
      }
      await pool.query(
        `insert into public.analytics_events (ts, type, path, slug, session, read_pct, dwell_ms) values ${vals.join(',')}`,
        params,
      );
      total += audience;
    }
    console.log(`seeded ${total} read events across ${posts.length} posts (4 shape archetypes)`);
    console.log('probe one: select * from public.feed_retention(array[(select slug from content.posts where slug like \'lt-%\' limit 1)]);');
  } finally {
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
