/**
 * scripts/fixtures/seed.mjs — populate ONE dense, realistic dataset that exercises
 * EVERY feature (see scripts/fixtures/plan.mjs for the blueprint).
 * ============================================================================
 * Idempotent-ish: run scripts/fixtures/reset.mjs first for a clean slate. Fixture
 * authors/readers use @seed.invalid; the owner (public.admins) is reused. Post bodies
 * come from scripts/fixtures/posts/<slug>.md (committed → reproducible), rendered
 * through the real build pipeline (src/lib/render-post.mjs).
 *
 *   node scripts/fixtures/reset.mjs && node scripts/fixtures/seed.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool, getAdminSupabase, textAndReadingMin } from '../_shared.mjs';
import { renderPostBody } from '../../src/lib/render-post.mjs';
import { AUTHORS, READERS, SERIES, FIELDS, POSTS, REQUESTS, SUBSCRIBERS, DOMAIN } from './plan.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PW = 'SeedData!2026';
const DAY = 86400000;

// Deterministic PRNG so a re-seed produces the same engagement (mulberry32 from a string).
function rng(seed) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const iso = (daysAgo) => new Date(Date.now() - daysAgo * DAY).toISOString();
const bodyMd = (slug) => fs.readFileSync(path.join(HERE, 'posts', `${slug}.md`), 'utf8');

// Extract a highlightable sentence + the first heading (id + text) from rendered HTML.
function pickQuote(html) {
  for (const m of html.matchAll(/<p>([\s\S]*?)<\/p>/g)) {
    const t = m[1].replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
    if (t.length >= 60) { const s = t.slice(0, 30 + Math.floor(t.length % 90)); return s.replace(/\W+\S*$/, '') || t.slice(0, 80); }
  }
  return null;
}
function pickHeading(html) {
  const m = html.match(/<h2 id="([^"]+)"[^>]*>([\s\S]*?)<\/h2>/);
  return m ? { anchor: m[1], heading: m[2].replace(/<[^>]+>/g, '').trim() } : { anchor: '', heading: '' };
}

const ENGAGE = {
  heavy: { views: 40, reads: 32, feedback: 22, progress: 12, highlights: 8, popularReaders: 4, comments: 6, notes: 4 },
  medium: { views: 18, reads: 14, feedback: 11, progress: 6, highlights: 4, popularReaders: 3, comments: 3, notes: 2 },
  light: { views: 8, reads: 6, feedback: 4, progress: 2, highlights: 1, popularReaders: 0, comments: 1, notes: 1 },
};
const REFERRERS = ['news.ycombinator.com', 'www.google.com', 'twitter.com', 'lobste.rs', null, null, null];

async function main() {
  const pool = getPool();
  const supa = getAdminSupabase();
  const t0 = Date.now();
  try {
    const ownerId = (await pool.query('select user_id from public.admins order by created_at asc nulls first limit 1')).rows[0].user_id;

    // ── auth-user helper (idempotent) ─────────────────────────────────────────
    const ensureUser = async (email, name) => {
      const { data, error } = await supa.auth.admin.createUser({ email, password: PW, email_confirm: true, user_metadata: { name } });
      if (!error) return data.user.id;
      if (/already|registered|exists/i.test(error.message)) {
        const { rows } = await pool.query('select id from auth.users where lower(email)=lower($1) limit 1', [email]);
        if (rows[0]) return rows[0].id;
      }
      throw error;
    };

    // ── authors ───────────────────────────────────────────────────────────────
    const A = {}; // key -> { id, handle, pen }
    for (const a of AUTHORS) {
      const id = a.reuseOwner ? ownerId : await ensureUser(`${a.key}@${DOMAIN}`, a.pen);
      await pool.query(
        `insert into content.profiles (id, handle, pen_name, role, can_publish, status, bio, avatar_url)
         values ($1,$2,$3,$4,$5,$6,$7,$8)
         on conflict (id) do update set handle=excluded.handle, pen_name=excluded.pen_name, role=excluded.role,
           can_publish=excluded.can_publish, status=excluded.status, bio=excluded.bio, avatar_url=excluded.avatar_url`,
        [id, a.handle, a.pen, a.role, a.canPublish !== false, a.status || 'active', a.bio || '', a.avatar || null],
      );
      A[a.key] = { id, handle: a.handle, pen: a.pen };
    }
    console.log(`authors: ${Object.keys(A).length}`);

    // ── readers ─────────────────────────────────────────────────────────────
    const readers = [];
    for (const name of READERS) {
      const email = `reader-${name.toLowerCase().replace(/[^a-z]+/g, '-')}@${DOMAIN}`;
      const id = await ensureUser(email, name);
      await pool.query(`insert into content.profiles (id, pen_name, role, status) values ($1,$2,'reader','active') on conflict (id) do update set pen_name=excluded.pen_name`, [id, name]);
      readers.push({ id, name });
    }
    console.log(`readers: ${readers.length}`);

    // ── series + fields ───────────────────────────────────────────────────────
    const S = {}; // slug -> id
    for (const s of SERIES) {
      const planned = s.slug === 'measuring-models' ? ['part three: the confusion matrix lies too', 'part four: shipping a metric you trust'] : [];
      const { rows } = await pool.query(
        `insert into content.series (owner_id, slug, title, summary, total, status, planned) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
        [A[s.owner].id, s.slug, s.title, s.summary, s.total, s.status, planned],
      );
      S[s.slug] = rows[0].id;
    }
    const F = {};
    for (const f of FIELDS) {
      const { rows } = await pool.query(`insert into content.fields (owner_id, slug, title, summary, mark) values ($1,$2,$3,$4,$5) returning id`,
        [A[f.owner].id, f.slug, f.title, f.summary, f.mark]);
      F[f.slug] = rows[0].id;
      let pos = 0;
      for (const sslug of f.series) await pool.query(`insert into content.field_series (field_id, series_id, position, accepted) values ($1,$2,$3,true) on conflict do nothing`, [rows[0].id, S[sslug], pos++]);
    }
    console.log(`series: ${Object.keys(S).length}, fields: ${Object.keys(F).length}`);

    // ── posts ─────────────────────────────────────────────────────────────────
    const posts = []; // { slug, id, authorKey, engage }
    for (const p of POSTS) {
      const md = bodyMd(p.slug);
      const html = await renderPostBody(md);
      const { text, readingMin } = textAndReadingMin(html);
      const author = A[p.author];
      const status = p.status || 'published';
      const visibility = p.visibility || 'public';
      const pubDate = p.status === 'scheduled' ? null : iso(p.pubDaysAgo ?? 20);
      const publishAt = p.status === 'scheduled' ? new Date(Date.now() + (p.publishInDays || 5) * DAY).toISOString() : null;
      const publishedAt = status === 'published' ? pubDate : null;
      const { rows } = await pool.query(
        `insert into content.posts (author_id, slug, title, description, pub_date, publish_at, tags, author_byline,
           status, visibility, body_md, body_html, body_text, reading_min, current_version, published_at, published_md)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,1,$15,$16) returning id`,
        [author.id, p.slug, p.title, p.description || '', pubDate, publishAt, p.tags || [], author.pen,
         status, visibility, md, html, text, readingMin, publishedAt, status === 'published' ? md : null],
      );
      const id = rows[0].id;
      // primary author (position 0) — belt for the seed_primary_author trigger.
      await pool.query(`insert into content.post_authors (post_id, user_id, position, accepted) values ($1,$2,0,true) on conflict do nothing`, [id, author.id]);
      // co-authors (accepted).
      let cpos = 1;
      for (const co of (p.co || [])) await pool.query(`insert into content.post_authors (post_id, user_id, position, accepted, invited_by) values ($1,$2,$3,true,$4) on conflict do nothing`, [id, A[co].id, cpos++, author.id]);
      // series membership (accepted).
      if (p.series) await pool.query(`insert into content.series_posts (series_id, post_id, position, accepted) values ($1,$2,$3,true) on conflict do nothing`, [S[p.series[0]], id, p.series[1]]);
      posts.push({ slug: p.slug, id, authorKey: p.author, engage: p.engage, html, status, visibility });
    }
    console.log(`posts: ${posts.length}`);

    // ── collaboration / pending requests (accepted = false) ────────────────────
    // A pending co-author invite → the invitee's Requests inbox ("needs you").
    {
      const rq = REQUESTS.coAuthorInvite;
      const html = await renderPostBody(bodyMd(rq.post));
      const { text, readingMin } = textAndReadingMin(html);
      const { rows } = await pool.query(
        `insert into content.posts (author_id, slug, title, description, tags, author_byline, status, visibility, body_md, body_html, body_text, reading_min, current_version)
         values ($1,$2,$3,$4,$5,$6,'draft','public',$7,$8,$9,$10,1) returning id`,
        [A[rq.primary].id, rq.post, rq.title, rq.description, rq.tags, A[rq.primary].pen, bodyMd(rq.post), html, text, readingMin]);
      await pool.query(`insert into content.post_authors (post_id, user_id, position, accepted) values ($1,$2,0,true) on conflict do nothing`, [rows[0].id, A[rq.primary].id]);
      await pool.query(`insert into content.post_authors (post_id, user_id, position, accepted, invited_by) values ($1,$2,1,false,$3) on conflict do nothing`, [rows[0].id, A[rq.invitee].id, A[rq.primary].id]);
    }
    // A pending SERIES proposal: daniel proposes a post into mira's series → mira's inbox.
    {
      const rq = REQUESTS.seriesProposal;
      const html = await renderPostBody(bodyMd(rq.post));
      const { text, readingMin } = textAndReadingMin(html);
      const { rows } = await pool.query(
        `insert into content.posts (author_id, slug, title, description, tags, author_byline, status, visibility, body_md, body_html, body_text, reading_min, current_version, pub_date, published_at)
         values ($1,$2,$3,$4,$5,$6,'published','public',$7,$8,$9,$10,1,$11,$11) returning id`,
        [A[rq.proposer].id, rq.post, rq.title, rq.description, rq.tags, A[rq.proposer].pen, bodyMd(rq.post), html, text, readingMin, iso(2)]);
      await pool.query(`insert into content.post_authors (post_id, user_id, position, accepted) values ($1,$2,0,true) on conflict do nothing`, [rows[0].id, A[rq.proposer].id]);
      await pool.query(`insert into content.series_posts (series_id, post_id, position, accepted, invited_by) values ($1,$2,6,false,$3) on conflict do nothing`, [S[rq.series], rows[0].id, A[rq.proposer].id]);
    }
    // A pending FIELD proposal: sofia proposes her series into the owner's field → owner's inbox.
    await pool.query(`insert into content.field_series (field_id, series_id, position, accepted, invited_by) values ($1,$2,9,false,$3) on conflict do nothing`,
      [F['systems-for-inference'], S['embeddings-from-scratch'], A['sofia'].id]);
    console.log('collaboration: 1 co-author invite + 1 series proposal + 1 field proposal (all pending)');

    // ── engagement (dense, deterministic) ───────────────────────────────────────
    let counters = { analytics: 0, feedback: 0, progress: 0, highlights: 0, hlComments: 0, comments: 0, votes: 0, notes: 0 };
    for (const post of posts) {
      if (!post.engage || post.status !== 'published' || post.visibility !== 'public') continue;
      const E = ENGAGE[post.engage]; if (!E) continue;
      const r = rng(post.slug);
      const holdWell = r();                                   // 0..1 — how well this post retains
      const quote = pickQuote(post.html); const { anchor, heading } = pickHeading(post.html);

      // analytics: views + reads (drives reading-shape curves, completion, referrers, popularity).
      for (let i = 0; i < E.views; i++) {
        await pool.query(`insert into public.analytics_events (ts, type, path, slug, ref_host, session) values ($1,'view',$2,$3,$4,$5)`,
          [iso(r() * 40), `/@${A[post.authorKey].handle}/${post.slug}`, post.slug, pick(r, REFERRERS), 's-' + Math.floor(r() * 1e9)]);
        counters.analytics++;
      }
      for (let i = 0; i < E.reads; i++) {
        const base = 30 + holdWell * 55;                      // retention centre
        const pct = Math.max(5, Math.min(100, Math.round(base + (r() - 0.5) * 70)));
        await pool.query(`insert into public.analytics_events (ts, type, path, slug, ref_host, session, read_pct, dwell_ms) values ($1,'read',$2,$3,$4,$5,$6,$7)`,
          [iso(r() * 40), `/@${A[post.authorKey].handle}/${post.slug}`, post.slug, pick(r, REFERRERS), 's-' + Math.floor(r() * 1e9), pct, Math.round(20000 + r() * 400000)]);
        counters.analytics++;
      }
      // feedback verdicts (anonymous, session-based) → "Did it hold?" + verdict aggregates.
      for (let i = 0; i < E.feedback; i++) {
        const x = r();
        const choice = x < holdWell * 0.8 + 0.15 ? 'held' : x < 0.85 ? 'skimmed' : 'lost';
        const readPct = choice === 'held' ? 80 + Math.floor(r() * 20) : choice === 'skimmed' ? 40 + Math.floor(r() * 40) : 10 + Math.floor(r() * 35);
        const lostPara = choice === 'lost' ? 1 + Math.floor(r() * 8) : null;
        await pool.query(`insert into public.feedback (post_id, session, choice, read_pct, lost_para, dwell_ms) values ($1,$2,$3,$4,$5,$6) on conflict (post_id, session) do nothing`,
          [post.id, `fb-${post.slug}-${i}`, choice, readPct, lostPara, Math.round(20000 + r() * 300000)]);
        counters.feedback++;
      }
      // reader_progress → "continue" (mid) + library (finished). Keyed by the post UUID.
      for (let i = 0; i < E.progress; i++) {
        const rd = readers[Math.floor(r() * readers.length)];
        const finished = r() < holdWell * 0.6;
        const pct = finished ? 100 : 20 + Math.floor(r() * 70);
        await pool.query(`insert into public.reader_progress (user_id, post_slug, pct, read, anchor, heading, updated_at) values ($1,$2,$3,$4,$5,$6,$7)
          on conflict (user_id, post_slug) do update set pct=excluded.pct, read=excluded.read, updated_at=excluded.updated_at`,
          [rd.id, post.id, pct, finished, finished ? '' : anchor, finished ? '' : heading, iso(r() * 20)]);
        counters.progress++;
      }
      // highlights — popular passage (>=3 readers on the SAME quote) + unique + a note or two.
      const hlIds = [];
      if (quote && E.popularReaders >= 3) {
        for (let i = 0; i < E.popularReaders; i++) {
          const rd = readers[i % readers.length];
          const { rows } = await pool.query(`insert into public.highlights (post_id, user_id, author_name, quote, note) values ($1,$2,$3,$4,$5) returning id`,
            [post.id, rd.id, rd.name, quote, i === 0 ? 'The line I keep coming back to.' : null]);
          hlIds.push({ id: rows[0].id, reader: rd });
          counters.highlights++;
        }
      }
      for (let i = 0; i < Math.max(0, E.highlights - E.popularReaders); i++) {
        const rd = readers[(i * 5 + 2) % readers.length];
        const q = pickQuote(post.html.slice(1000 + i * 600)) || quote;
        if (!q) continue;
        const { rows } = await pool.query(`insert into public.highlights (post_id, user_id, author_name, quote, note) values ($1,$2,$3,$4,$5) returning id`,
          [post.id, rd.id, rd.name, q, i === 0 ? 'Worth a second read.' : null]);
        hlIds.push({ id: rows[0].id, reader: rd });
        counters.highlights++;
      }
      // a discussion thread on the first highlight, incl. an OWNER reply (author_is_admin → "Author" badge).
      if (hlIds.length) {
        const owner = readers.length; // placeholder
        await pool.query(`insert into public.highlight_comments (highlight_id, user_id, author_name, body, author_is_admin) values ($1,$2,$3,$4,false)`,
          [hlIds[0].id, hlIds[0].reader.id, hlIds[0].reader.name, 'Does this still hold at higher concurrency?']);
        await pool.query(`insert into public.highlight_comments (highlight_id, user_id, author_name, body, author_is_admin) values ($1,$2,$3,$4,true)`,
          [hlIds[0].id, ownerId, A.owner.pen, 'Good question — it does until the cache saturates; then re-measure.']);
        counters.hlComments += 2;
      }
      // comments — a thread (top-level + reply), an OWNER reply (badge), and upvotes.
      const cIds = [];
      for (let i = 0; i < E.comments; i++) {
        const rd = readers[(i * 3 + 1) % readers.length];
        const { rows } = await pool.query(`insert into public.comments (post_id, user_id, author_name, body, author_is_admin) values ($1,$2,$3,$4,false) returning id`,
          [post.id, rd.id, rd.name, pick(r, ['This matched what we saw in production.', 'Great write-up — the diagram helped.', 'Curious how this holds for long-context models.', 'The table is the part I\'ll be quoting.', 'Bookmarking the code snippet.'])]);
        cIds.push(rows[0].id); counters.comments++;
      }
      if (cIds.length) {
        const { rows } = await pool.query(`insert into public.comments (post_id, user_id, author_name, body, parent_id, author_is_admin) values ($1,$2,$3,$4,$5,true) returning id`,
          [post.id, ownerId, A.owner.pen, 'Thanks — reran it this morning and the numbers held.', cIds[0]]);
        cIds.push(rows[0].id); counters.comments++;
        // upvotes on the first comment from a few readers.
        for (let i = 0; i < Math.min(readers.length, 3 + Math.floor(r() * 6)); i++) {
          await pool.query(`insert into public.votes (user_id, kind, target_id) values ($1,'comment',$2) on conflict do nothing`, [readers[i].id, cIds[0]]);
          counters.votes++;
        }
      }
      // private notes.
      for (let i = 0; i < E.notes; i++) {
        const rd = readers[(i * 7 + 4) % readers.length];
        await pool.query(`insert into public.notes (post_id, user_id, author_name, body) values ($1,$2,$3,$4) on conflict (post_id, user_id) do nothing`,
          [post.id, rd.id, rd.name, pick(r, ['Follow up on the reranker claim.', 'Compare with our p99 numbers.', 'Ask about the cache eviction policy.', 'Try the batching trick next sprint.'])]);
        counters.notes++;
      }
    }
    console.log('engagement:', JSON.stringify(counters));

    // ── subscribers (audience panel) ────────────────────────────────────────────
    const mk = (i, status) => pool.query(
      `insert into public.subscribers (email, status, confirm_token, unsubscribe_token, confirmed_at, created_at)
       values ($1,$2,gen_random_uuid(),gen_random_uuid(),$3,$4) on conflict (email) do nothing`,
      [`subscriber-${status}-${i}@${DOMAIN}`, status, status === 'confirmed' ? iso(i) : null, iso(i + 5)]);
    for (let i = 0; i < SUBSCRIBERS.confirmed; i++) await mk(i, 'confirmed');
    for (let i = 0; i < SUBSCRIBERS.pending; i++) await mk(i, 'pending');
    for (let i = 0; i < SUBSCRIBERS.unsubscribed; i++) await mk(i, 'unsubscribed');
    console.log(`subscribers: ${SUBSCRIBERS.confirmed + SUBSCRIBERS.pending + SUBSCRIBERS.unsubscribed}`);

    console.log(`\nSeeded in ${((Date.now() - t0) / 1000).toFixed(1)}s.`);
  } finally {
    await pool.end();
  }
  process.exit(0); // D2 worker_thread keeps the loop alive otherwise.
}

main().catch((e) => { console.error(e); process.exit(1); });
