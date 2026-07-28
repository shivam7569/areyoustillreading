/**
 * GET /api/admin/analytics?range=7d|30d|90d|all — traffic summary for the Studio.
 * Admin-gated. Reads public.analytics_events (service role; RLS deny-all to anon)
 * plus a couple of conversion counts from subscribers/entitlements.
 *
 * Aggregation is done in JS over the range's rows (kept simple + reliable — no
 * dependence on PostgREST aggregate config). Fine for a personal blog's volume; if
 * events ever explode past the LIMIT below, switch to a Postgres view/RPC — the
 * response shape stays the same. Returns { configured:false } if the table is
 * missing, so the dashboard can prompt to run db/analytics.sql.
 */
import { requireAdmin, json } from '../../../lib/require-admin.js';

const LIMIT = 20000; // max events pulled per query (JS-side aggregation cap)
const RANGES = { '7d': 7, '30d': 30, '90d': 90 };

/**
 * POST /api/admin/analytics — data maintenance (retention + test-data cleanup).
 * Body { action: 'purge-synthetic' } deletes the load-test rows (session prefix
 * 'lt_'); { action: 'purge-old', days } deletes events older than `days`.
 * Admin-gated; service-role DELETE (the table is RLS deny-all to the anon key).
 */
export async function onRequestPost({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (!gate.ok) return json({ error: gate.error }, gate.status);
  const sb = env.SUPABASE_URL;
  const service = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sb || !service) return json({ error: 'Server not configured (Supabase).' }, 400);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const action = body && body.action;

  let filter;
  if (action === 'purge-synthetic') {
    // Load-test rows use session ids prefixed 'lt_' (see the loadtest script). Real
    // sessions are bare base36 with no underscore, so this won't touch live traffic.
    filter = 'session=like.lt_*';
  } else if (action === 'purge-old') {
    const days = Math.max(1, Math.min(3650, parseInt(body.days, 10) || 90));
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    filter = `ts=lt.${encodeURIComponent(cutoff)}`;
  } else {
    return json({ error: 'Unknown action' }, 400);
  }

  const auth = { Authorization: `Bearer ${service}`, apikey: service };
  // Count first (for a truthful "removed N" report).
  let removed = 0;
  try {
    const cr = await fetch(`${sb}/rest/v1/analytics_events?select=id&${filter}`, { headers: { ...auth, Prefer: 'count=exact', Range: '0-0' } });
    const m = /\/(\d+)\s*$/.exec(cr.headers.get('content-range') || '');
    removed = m ? parseInt(m[1], 10) : 0;
  } catch { /* count is best-effort */ }

  const dr = await fetch(`${sb}/rest/v1/analytics_events?${filter}`, {
    method: 'DELETE',
    headers: { ...auth, Prefer: 'return=minimal' },
  });
  if (!dr.ok) return json({ error: `Delete failed (${dr.status})` }, 400);
  return json({ ok: true, removed, action });
}

export async function onRequestGet({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (!gate.ok) return json({ error: gate.error }, gate.status);

  const sb = env.SUPABASE_URL;
  const service = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sb || !service) return json({ error: 'Server not configured (Supabase).' }, 400);
  const auth = { Authorization: `Bearer ${service}`, apikey: service };

  const url = new URL(request.url);
  const range = url.searchParams.get('range') || '30d';
  const days = RANGES[range]; // undefined => 'all'
  const sinceIso = days ? new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString() : null;
  const tsFilter = sinceIso ? `&ts=gte.${encodeURIComponent(sinceIso)}` : '';

  // --- Pull the range's events (minimal columns) ----------------------------
  let events;
  try {
    const r = await fetch(
      `${sb}/rest/v1/analytics_events?select=type,slug,path,session,ref_host,read_pct,dwell_ms,ts${tsFilter}&order=ts.desc&limit=${LIMIT}`,
      { headers: auth },
    );
    if (r.status === 404) return json({ configured: false });
    if (!r.ok) return json({ error: `Could not load analytics (${r.status})` }, 400);
    events = await r.json();
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 400);
  }
  if (!Array.isArray(events)) events = [];

  // --- Aggregate in JS ------------------------------------------------------
  const views = events.filter((e) => e.type === 'view');

  // The client re-sends a 'read' on every tab-hide and at pagehide, so a single
  // visit can produce several 'read' rows. Collapse them to ONE per (session,page),
  // keeping the MAX scroll depth + MAX foreground dwell — the fullest snapshot —
  // so re-sends neither inflate the read count nor drag the averages down.
  const readMap = new Map();
  for (const e of events) {
    if (e.type !== 'read') continue;
    const key = (e.session || '?') + '|' + (e.slug || e.path || '');
    let cur = readMap.get(key);
    if (!cur) { cur = { slug: e.slug || null, read_pct: null, dwell_ms: null }; readMap.set(key, cur); }
    if (typeof e.read_pct === 'number' && (cur.read_pct === null || e.read_pct > cur.read_pct)) cur.read_pct = e.read_pct;
    if (typeof e.dwell_ms === 'number' && (cur.dwell_ms === null || e.dwell_ms > cur.dwell_ms)) cur.dwell_ms = e.dwell_ms;
  }
  const reads = [...readMap.values()];

  const uniqueSessions = new Set(views.map((e) => e.session).filter(Boolean)).size;
  const readPcts = reads.map((e) => e.read_pct).filter((n) => typeof n === 'number');
  const dwells = reads.map((e) => e.dwell_ms).filter((n) => typeof n === 'number' && n > 0);
  const avg = (arr) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0);

  // Per-post: views + average read depth.
  const postMap = new Map();
  for (const e of views) {
    if (!e.slug) continue;
    const p = postMap.get(e.slug) || { slug: e.slug, views: 0, readCount: 0, pctSum: 0 };
    p.views += 1;
    postMap.set(e.slug, p);
  }
  for (const e of reads) {
    if (!e.slug || typeof e.read_pct !== 'number') continue;
    const p = postMap.get(e.slug) || { slug: e.slug, views: 0, readCount: 0, pctSum: 0 };
    p.readCount += 1;
    p.pctSum += e.read_pct;
    postMap.set(e.slug, p);
  }
  const topPosts = [...postMap.values()]
    .map((p) => ({ slug: p.slug, views: p.views, avgReadPct: p.readCount ? Math.round(p.pctSum / p.readCount) : null }))
    .sort((a, b) => b.views - a.views)
    .slice(0, 12);

  // Referrers (external hostnames only).
  const refMap = new Map();
  for (const e of views) {
    if (!e.ref_host) continue;
    refMap.set(e.ref_host, (refMap.get(e.ref_host) || 0) + 1);
  }
  const referrers = [...refMap.entries()]
    .map(([host, count]) => ({ host, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
  const directViews = views.filter((e) => !e.ref_host).length;

  // Views per day (ascending), so the dashboard can draw a bar chart.
  const dayMap = new Map();
  for (const e of views) {
    const d = typeof e.ts === 'string' ? e.ts.slice(0, 10) : null;
    if (!d) continue;
    dayMap.set(d, (dayMap.get(d) || 0) + 1);
  }
  const byDay = [...dayMap.entries()].map(([date, v]) => ({ date, views: v })).sort((a, b) => a.date.localeCompare(b.date));

  // --- Conversion counts in range (exact counts via Content-Range) ----------
  async function countExact(pathAndFilter) {
    try {
      const r = await fetch(`${sb}/rest/v1/${pathAndFilter}`, { headers: { ...auth, Prefer: 'count=exact', Range: '0-0' } });
      const m = /\/(\d+)\s*$/.exec(r.headers.get('content-range') || '');
      return m ? parseInt(m[1], 10) : 0;
    } catch {
      return 0;
    }
  }
  const subFilter = sinceIso ? `&confirmed_at=gte.${encodeURIComponent(sinceIso)}` : '';
  const entFilter = sinceIso ? `&created_at=gte.${encodeURIComponent(sinceIso)}` : '';
  const [newSubscribers, unlocks] = await Promise.all([
    countExact(`subscribers?select=id&status=eq.confirmed${subFilter}`),
    countExact(`entitlements?select=id&post_id=not.is.null${entFilter}`),
  ]);

  return json({
    configured: true,
    range,
    totals: {
      views: views.length,
      uniqueSessions,
      reads: reads.length,
      avgReadPct: avg(readPcts),
      avgDwellMs: avg(dwells),
    },
    topPosts,
    referrers,
    directViews,
    byDay,
    conversion: { newSubscribers, unlocks },
    truncated: events.length >= LIMIT,
  });
}
