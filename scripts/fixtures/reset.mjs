/**
 * scripts/fixtures/reset.mjs — wipe ALL test/fake data for a clean testing start.
 * ============================================================================
 * Deletes every post / series / field, every reader-engagement row (progress,
 * notes, highlights + their discussion, comments, feedback, votes, analytics,
 * subscribers), all non-owner profiles, and every @loadtest.invalid auth user.
 *
 * PRESERVES: the site owner (public.admins) — their auth user, admin membership,
 * and their content.profiles row — plus any other REAL (non-loadtest) auth users
 * (their profiles are reset to "plain reader"; their login stays).
 *
 *   node scripts/fixtures/reset.mjs
 */
import { getPool, getAdminSupabase } from '../_shared.mjs';

async function main() {
  const pool = getPool();
  const supa = getAdminSupabase();
  try {
    const owner = (await pool.query('select user_id from public.admins order by created_at asc nulls first limit 1')).rows[0];
    if (!owner) { console.error('No owner in public.admins — aborting.'); process.exit(1); }
    const ownerId = owner.user_id;
    console.log('Owner (preserved):', ownerId);

    const before = await counts(pool);
    console.log('\nBEFORE:', JSON.stringify(before));

    // 1) Content — deleting posts/series/fields cascades post_authors / series_posts / field_series.
    await pool.query('delete from content.posts');
    await pool.query('delete from content.series');
    await pool.query('delete from content.fields');

    // 2) Reader-engagement rows (highlight_comments cascades from highlights).
    for (const t of ['reader_progress', 'notes', 'highlights', 'comments', 'feedback', 'votes', 'analytics_events', 'subscribers']) {
      try { await pool.query(`delete from public.${t}`); } catch (e) { console.warn(`  (skip public.${t}: ${e.message})`); }
    }

    // 3) Non-owner profiles → reset everyone else to "plain reader" (keeps the owner's @handle).
    await pool.query('delete from content.profiles where id <> $1', [ownerId]);

    // 4) Delete every @loadtest.invalid auth user (cascades any remaining own-rows). Real users stay.
    const lt = (await pool.query("select id, email from auth.users where email like '%@loadtest.invalid'")).rows;
    let removed = 0;
    for (const u of lt) { const { error } = await supa.auth.admin.deleteUser(u.id); if (!error) removed++; else console.warn(`  could not delete ${u.email}: ${error.message}`); }
    console.log(`\nloadtest auth users removed: ${removed}/${lt.rows?.length ?? lt.length}`);

    const after = await counts(pool);
    console.log('AFTER: ', JSON.stringify(after));
    const realUsers = (await pool.query("select email from auth.users order by created_at")).rows.map((r) => r.email);
    console.log('remaining auth users:', realUsers.join(', '));
    console.log('\nReset complete. Run: node scripts/fixtures/seed.mjs');
  } finally {
    await pool.end();
  }
}

async function counts(pool) {
  const one = async (sql) => (await pool.query(sql)).rows[0].c;
  return {
    posts: await one('select count(*) c from content.posts'),
    series: await one('select count(*) c from content.series'),
    fields: await one('select count(*) c from content.fields'),
    profiles: await one('select count(*) c from content.profiles'),
    reader_progress: await one('select count(*) c from public.reader_progress'),
    highlights: await one('select count(*) c from public.highlights'),
    comments: await one('select count(*) c from public.comments'),
    feedback: await one('select count(*) c from public.feedback'),
    notes: await one('select count(*) c from public.notes'),
    analytics: await one('select count(*) c from public.analytics_events'),
    subscribers: await one('select count(*) c from public.subscribers'),
    auth_users: await one('select count(*) c from auth.users'),
  };
}

main().catch((e) => { console.error(e); process.exit(1); });
