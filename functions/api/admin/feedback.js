/**
 * /api/admin/feedback — the reader-verdict aggregates for the Studio (Analytics).
 * ----------------------------------------------------------------------------
 * GET → { posts: [{ slug, total, held, skimmed, lost, lostMedian }], totals, setup }
 *
 * Admin-gated (requireAdmin) + service-role read of the deny-all public.feedback
 * table (db/feedback.sql). Powers the "Did it hold?" panel on /admin/analytics so
 * the author sees, per post, how readers landed (held / skimmed / lost) and where
 * attention broke — the moderator-side counterpart of the reader poll (Feedback.astro
 * → /api/feedback). `setup:true` means the table hasn't been created yet.
 *
 * ENV: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */
import { requireAdmin, json } from '../../../lib/require-admin.js';

const EMPTY = { posts: [], totals: { held: 0, skimmed: 0, lost: 0, total: 0 } };

export async function onRequestGet({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (!gate.ok) return json({ error: gate.error }, gate.status);

  const sb = env.SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sb || !key) return json(EMPTY);

  let rows;
  try {
    const r = await fetch(`${sb}/rest/v1/feedback?select=post_id,choice,lost_para`, {
      headers: { Authorization: `Bearer ${key}`, apikey: key, Range: '0-99999' },
      signal: AbortSignal.timeout(6000),
    });
    if (r.status === 404) return json({ ...EMPTY, setup: true }); // table not created yet
    if (!r.ok) return json(EMPTY);
    rows = await r.json();
  } catch {
    return json(EMPTY);
  }
  if (!Array.isArray(rows)) return json(EMPTY);

  const byPost = new Map();
  const totals = { held: 0, skimmed: 0, lost: 0, total: 0 };
  for (const row of rows) {
    const c = row.choice;
    if (totals[c] == null) continue;
    if (!byPost.has(row.post_id)) byPost.set(row.post_id, { slug: row.post_id, held: 0, skimmed: 0, lost: 0, total: 0, _lost: [] });
    const p = byPost.get(row.post_id);
    p[c]++; p.total++;
    totals[c]++; totals.total++;
    if (c === 'lost' && Number.isFinite(row.lost_para)) p._lost.push(row.lost_para);
  }
  const posts = [...byPost.values()].map((p) => {
    let lostMedian = null;
    if (p._lost.length) { p._lost.sort((a, b) => a - b); lostMedian = p._lost[Math.floor((p._lost.length - 1) / 2)]; }
    return { slug: p.slug, total: p.total, held: p.held, skimmed: p.skimmed, lost: p.lost, lostMedian };
  }).sort((a, b) => b.total - a.total);

  return json({ posts, totals });
}
