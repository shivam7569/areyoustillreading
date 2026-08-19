/**
 * scripts/loadtest/teardown.mjs — remove every load-test artifact.
 * ============================================================================
 * Deletes all lt- content and all @loadtest.invalid auth users (which cascades
 * their profiles + remaining reader rows). Real content is untouched — everything
 * is matched by the lt- slug / @loadtest.invalid tag the seeder applied.
 *
 *   node scripts/loadtest/teardown.mjs
 */
import { getPool, getAdminSupabase, LT } from '../_shared.mjs';

async function main() {
  const pool = getPool();
  const supa = getAdminSupabase();
  try {
    // Reader interactions tied to lt- posts (the rest cascade when the user is deleted).
    const rp = await pool.query(`delete from public.reader_progress where post_slug like '${LT.prefix}%'`);
    const nt = await pool.query(`delete from public.notes         where post_id  like '${LT.prefix}%'`);
    const an = await pool.query(`delete from public.analytics_events where session like 'lt-%' or slug like '${LT.prefix}%'`);
    console.log(`analytics events removed: ${an.rowCount}`);
    // Content (joins cascade from posts/series/fields). posts.author_id is ON DELETE
    // RESTRICT, so posts MUST go before the auth users are deleted below.
    const po = await pool.query(`delete from content.posts  where slug like '${LT.prefix}%'`);
    const se = await pool.query(`delete from content.series where slug like '${LT.prefix}%'`);
    const fi = await pool.query(`delete from content.fields where slug like '${LT.prefix}%'`);
    console.log(`content removed — posts ${po.rowCount}, series ${se.rowCount}, fields ${fi.rowCount}; reader_progress ${rp.rowCount}, notes ${nt.rowCount}`);

    // Auth users (cascades content.profiles + own-row reader rows). Enumerate via pg
    // (the pool is already open) rather than the offset-paginated admin listUsers —
    // deleting while paging by offset would skip the rows that shift down.
    const lt = await pool.query('select id, email from auth.users where email like $1', [`%@${LT.domain}`]);
    let removed = 0;
    for (const u of lt.rows) {
      const { error: de } = await supa.auth.admin.deleteUser(u.id);
      if (de) console.warn(`  could not delete ${u.email}: ${de.message}`); else removed++;
    }
    console.log(`auth users removed: ${removed} / ${lt.rows.length}`);
    console.log('\nTeardown complete.');
  } finally {
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
