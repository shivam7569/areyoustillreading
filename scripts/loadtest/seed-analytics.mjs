/**
 * scripts/loadtest/seed-analytics.mjs — a realistic fake reading audience.
 * ============================================================================
 * For every lt- post, generates read events whose aggregate "readers remaining at
 * x%" traces a TARGET retention curve — one of four archetypes, jittered per post so
 * no two are identical. Uses inverse sampling: a reader's engagement u ~ U(0,100)
 * maps to the furthest decile whose target retention is still >= u, so the resulting
 * curve reproduces the target. This makes the feed's reading-shape graphs clearly
 * distinct (holds / early cliff / loses midway / strong finish) instead of flat.
 * Tagged by the lt- slug; cleared by teardown.
 *
 *   node scripts/loadtest/seed-analytics.mjs   (npm run loadtest:analytics)
 */
import { getPool, LT } from '../_shared.mjs';

// Target readers-remaining (%) at deciles 10,20,…,100. Monotonic non-increasing.
const ARCHETYPES = [
  [100, 97, 93, 89, 85, 81, 76, 71, 65, 57], // holds to the end (gentle decline)
  [100, 70, 53, 48, 45, 43, 41, 39, 36, 32], // early cliff (drops hard by 20%)
  [100, 96, 91, 82, 66, 50, 43, 39, 35, 30], // loses readers midway
  [100, 99, 97, 94, 91, 87, 82, 77, 70, 61], // strong finish (short, mostly read)
];
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// Jitter a target curve per post, then re-enforce non-increasing so it stays a real shape.
function jitter(base) {
  const t = base.map((v, i) => clamp(v + (Math.random() * 12 - 6), i === 0 ? 100 : 8, 100));
  t[0] = 100;
  for (let i = 1; i < t.length; i++) if (t[i] > t[i - 1]) t[i] = t[i - 1];
  return t;
}
// One reader's read_pct given a target curve (inverse sampling; see header).
function readerPct(target) {
  const u = Math.random() * 100;
  let reach = 10;
  for (let d = 100; d >= 10; d -= 10) { if (target[d / 10 - 1] >= u) { reach = d; break; } }
  return clamp(reach + Math.floor(Math.random() * 10), 0, 100); // land inside the [reach, reach+9] band
}
const sid = () => 'lt-' + Math.random().toString(36).slice(2, 11);

async function main() {
  const pool = getPool();
  try {
    const posts = (await pool.query(`select slug from content.posts where slug like '${LT.prefix}%' order by slug`)).rows.map((r) => r.slug);
    if (!posts.length) { console.log('No lt- posts — run loadtest:seed first.'); return; }
    await pool.query(`delete from public.analytics_events where session like 'lt-%' or slug like '${LT.prefix}%'`);

    let total = 0;
    for (let i = 0; i < posts.length; i++) {
      const slug = posts[i];
      const target = jitter(ARCHETYPES[i % ARCHETYPES.length]);
      const audience = 22 + Math.floor(Math.random() * 40);   // enough readers for a smooth shape
      const vals = [], params = []; let n = 0;
      for (let k = 0; k < audience; k++) {
        params.push('read', '/blog/' + slug, slug, sid(), readerPct(target), 20000 + Math.floor(Math.random() * 180000));
        vals.push(`(now() - (random()*45 || ' days')::interval, $${n + 1},$${n + 2},$${n + 3},$${n + 4},$${n + 5},$${n + 6})`);
        n += 6;
      }
      await pool.query(
        `insert into public.analytics_events (ts, type, path, slug, session, read_pct, dwell_ms) values ${vals.join(',')}`,
        params,
      );
      total += audience;
    }
    console.log(`seeded ${total} read events across ${posts.length} posts (4 jittered retention archetypes)`);
  } finally {
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
