/**
 * POST /api/track — first-party, cookieless analytics beacon ingest.
 * =============================================================================
 * Receives tiny JSON beacons from the public site (src/components/Analytics.astro)
 * and appends one row to public.analytics_events (service role; the table is
 * RLS-locked deny-all to the anon key — see db/analytics.sql).
 *
 * PRIVACY: stores NO cookies, NO IP, NO user id, NO personal data. Only a path, a
 * coarse country (from Cloudflare), an external referrer HOSTNAME, and a random
 * per-tab session id. Nothing here can identify or follow a person.
 *
 * RESILIENCE: analytics must never affect the page. Every path returns 204 and all
 * errors are swallowed — a failed/absent table just means no data is recorded.
 * Public endpoint (beacons have no auth), so it validates + bot-filters + soft
 * origin-checks the input; spoofed events are low-value for a personal blog.
 */

import { rateLimit, clientIp } from '../../lib/rate-limit.js';

const NOOP = () => new Response(null, { status: 204 });

function clampInt(v, lo, hi) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return null;
  return Math.max(lo, Math.min(hi, n));
}

export async function onRequestPost(ctx) {
  try {
    return await handle(ctx);
  } catch {
    // Never surface analytics errors to the visitor.
    return NOOP();
  }
}

async function handle({ request, env }) {
  // Soft origin check: reject beacons that clearly came from another site. Absent
  // Origin (some same-origin beacons) is allowed; a present, foreign Origin is not.
  // Compare the PARSED host (not a substring), so look-alikes like
  // evil-areyoustillreading.dev don't slip past an unanchored suffix match.
  const origin = request.headers.get('origin') || '';
  if (origin) {
    let host;
    try { host = new URL(origin).hostname; } catch { return NOOP(); }
    const ok =
      host === 'areyoustillreading.dev' ||
      host.endsWith('.areyoustillreading.dev') ||
      host === 'localhost' ||
      host === '127.0.0.1';
    if (!ok) return NOOP();
  }

  // Per-IP rate limit (fail-open, silent). Generous — a reader legitimately loads
  // several pages a minute, each firing a view + a read beacon.
  const rl = await rateLimit(env, 'track', clientIp(request), 100, 60);
  if (!rl.ok) return NOOP();

  // Beacons arrive as application/json (Blob) or text/plain; read as text + parse.
  let body;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return NOOP();
  }

  const type = body && body.t;
  if (type !== 'view' && type !== 'read') return NOOP();

  let path = typeof body.p === 'string' ? body.p : '';
  if (!path.startsWith('/') || path.length > 512) return NOOP();
  // Never record the studio (defense in depth — the beacon already skips it).
  if (path.startsWith('/admin')) return NOOP();
  // Drop query/hash if any slipped through.
  path = path.replace(/[?#].*$/, '');

  // Bot filter by user-agent — keep obvious crawlers/monitors out of the numbers.
  const ua = request.headers.get('user-agent') || '';
  if (/bot|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|quora link|pinterest|headless|lighthouse|pingdom|uptimerobot|monitor|curl|wget|python-requests/i.test(ua)) {
    return NOOP();
  }

  const sb = env.SUPABASE_URL;
  const service = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sb || !service) return NOOP();

  // Derive the post slug so the dashboard + homepage popularity can rank posts.
  // Two live post URL shapes: /blog/<slug> (legacy file post) and /@handle/<slug>
  // (the DB permalink — the one publish path today). The author (/@handle), series
  // (/@handle/s/<slug>) and field (/@handle/f/<slug>) routes are NOT posts.
  let slug = null;
  let m = /^\/blog\/([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)\/?$/.exec(path);
  if (m) slug = m[1];
  else {
    m = /^\/@[^/]+\/([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)\/?$/.exec(path);
    if (m && m[1] !== 's' && m[1] !== 'f') slug = m[1];
  }

  const country = request.headers.get('cf-ipcountry') || null;
  const refHost = typeof body.r === 'string' && body.r ? body.r.slice(0, 128) : null;
  const session = typeof body.s === 'string' && body.s ? body.s.slice(0, 40) : null;

  const row = {
    type,
    path: path.slice(0, 512),
    slug,
    ref_host: refHost,
    session,
    country: country && country !== 'XX' ? country : null,
    read_pct: type === 'read' ? clampInt(body.pct, 0, 100) : null,
    dwell_ms: type === 'read' ? clampInt(body.ms, 0, 24 * 60 * 60 * 1000) : null,
  };

  // Best-effort insert; swallow any failure (missing table, transient error).
  try {
    await fetch(`${sb}/rest/v1/analytics_events`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${service}`,
        apikey: service,
        'content-type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify([row]),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    /* best-effort */
  }

  return NOOP();
}
