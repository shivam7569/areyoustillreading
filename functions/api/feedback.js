/**
 * /api/feedback — "Did it hold?" reader-feedback poll (anonymous, one tap).
 * =============================================================================
 * GET  ?slug=<post>&fid=<id>  → the aggregate for that post { total, counts, lostMedian }
 *                               plus this browser's own answer (if any).
 * POST { slug, fid, choice, lostPara?, readPct?, dwellMs? }
 *                             → upsert this browser's answer, then return the fresh
 *                               aggregate (so the reader sees results immediately).
 *
 * Anonymous by design (the poll says "one tap, no account"). The browser is
 * identified only by an opaque localStorage id (`fid`) — not PII. The public.feedback
 * table is deny-all under RLS (db/feedback.sql); only THIS function touches it, with
 * the service-role key — exactly the analytics_events model (functions/api/track.js).
 *
 * RESILIENCE: the poll must never break a post. Missing env / missing table /
 * transient error → a benign empty aggregate (HTTP 200), never a 5xx.
 *
 * ENV: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */
import { rateLimit, clientIp } from '../../lib/rate-limit.js';

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const FID_RE = /^[a-z0-9]{6,64}$/;
const CHOICES = ['held', 'skimmed', 'lost'];
const EMPTY = { ok: true, total: 0, counts: { held: 0, skimmed: 0, lost: 0 }, lostMedian: null, own: null };

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

function clampInt(v, lo, hi) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return null;
  return Math.max(lo, Math.min(hi, n));
}

function sbHeaders(key) {
  return { Authorization: `Bearer ${key}`, apikey: key, 'content-type': 'application/json' };
}

// Soft same-origin check (mirrors /api/track): a present, foreign Origin is rejected;
// absent Origin is allowed (some same-origin fetches omit it).
function originOk(request) {
  const origin = request.headers.get('origin') || '';
  if (!origin) return true;
  let host;
  try { host = new URL(origin).hostname; } catch { return false; }
  return host === 'areyoustillreading.dev' || host.endsWith('.areyoustillreading.dev') || host === 'localhost' || host === '127.0.0.1';
}

// Compute { total, counts, lostMedian, own } for a post from the raw rows.
function aggregate(rows, fid) {
  const counts = { held: 0, skimmed: 0, lost: 0 };
  const lostParas = [];
  let own = null;
  for (const r of rows) {
    if (counts[r.choice] != null) counts[r.choice]++;
    if (r.choice === 'lost' && Number.isFinite(r.lost_para)) lostParas.push(r.lost_para);
    if (fid && r.session === fid) own = { choice: r.choice, lostPara: r.lost_para ?? null };
  }
  const total = counts.held + counts.skimmed + counts.lost;
  let lostMedian = null;
  if (lostParas.length) {
    lostParas.sort((a, b) => a - b);
    lostMedian = lostParas[Math.floor((lostParas.length - 1) / 2)];
  }
  return { ok: true, total, counts, lostMedian, own };
}

// Read every answer for a post (service role bypasses RLS). Best-effort — any failure
// (missing table before db/feedback.sql is applied, transient) → null → empty aggregate.
async function fetchRows(env, slug) {
  const sb = env.SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sb || !key) return null;
  try {
    const r = await fetch(
      `${sb}/rest/v1/feedback?post_id=eq.${encodeURIComponent(slug)}&select=session,choice,lost_para`,
      { headers: sbHeaders(key), signal: AbortSignal.timeout(5000) }
    );
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const slug = url.searchParams.get('slug') || '';
  const fid = url.searchParams.get('fid') || '';
  if (!SLUG_RE.test(slug)) return json(EMPTY);
  const rows = await fetchRows(env, slug);
  if (!rows) return json(EMPTY);
  return json(aggregate(rows, FID_RE.test(fid) ? fid : null));
}

export async function onRequestPost({ request, env }) {
  if (!originOk(request)) return json(EMPTY);

  // Per-IP rate limit (fail-open). A reader submits a handful of times at most
  // (choice + a few paragraph nudges), so a tight cap is fine.
  const rl = await rateLimit(env, 'feedback', clientIp(request), 40, 60);
  if (!rl.ok) return json(EMPTY);

  let body;
  try { body = await request.json(); } catch { return json({ ...EMPTY, ok: false }, 400); }

  const slug = typeof body.slug === 'string' ? body.slug : '';
  const fid = typeof body.fid === 'string' ? body.fid : '';
  const choice = typeof body.choice === 'string' ? body.choice : '';
  if (!SLUG_RE.test(slug) || !FID_RE.test(fid) || !CHOICES.includes(choice)) {
    return json({ ...EMPTY, ok: false }, 400);
  }
  const lostPara = choice === 'lost' ? clampInt(body.lostPara, 1, 1000) : null;
  const readPct = clampInt(body.readPct, 0, 100);
  const dwellMs = clampInt(body.dwellMs, 0, 24 * 60 * 60 * 1000);

  const sb = env.SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (sb && key) {
    const row = { post_id: slug, session: fid, choice, lost_para: lostPara, read_pct: readPct, dwell_ms: dwellMs };
    try {
      // Upsert on (post_id, session): a re-answer / paragraph-nudge updates the row.
      await fetch(`${sb}/rest/v1/feedback?on_conflict=post_id,session`, {
        method: 'POST',
        headers: { ...sbHeaders(key), Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify([row]),
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      /* best-effort — still return the aggregate below */
    }
  }

  // Return the fresh aggregate so the reader immediately sees where others landed.
  const rows = await fetchRows(env, slug);
  if (!rows) {
    // No table yet / read failed: reflect at least this answer so the UI isn't empty.
    const counts = { held: 0, skimmed: 0, lost: 0 };
    counts[choice] = 1;
    return json({ ok: true, total: 1, counts, lostMedian: choice === 'lost' ? lostPara : null, own: { choice, lostPara } });
  }
  return json(aggregate(rows, fid));
}
