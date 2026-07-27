/**
 * GET /api/admin/overview — the at-a-glance KPIs for the dashboard Home.
 * Admin-gated. Aggregates the three data planes a solo owner checks first:
 * posts (total / published / drafts / paywalled), audience (subscriber counts),
 * and revenue (sales + estimated gross). Each plane degrades independently — a
 * failure in one still returns the others.
 */
import { requireAdmin, json } from '../../../lib/require-admin.js';
import { listPosts } from '../../../lib/list-posts.js';

export async function onRequestGet({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (!gate.ok) return json({ error: gate.error }, gate.status);

  const sb = env.SUPABASE_URL;
  const service = env.SUPABASE_SERVICE_ROLE_KEY;
  const auth = { Authorization: `Bearer ${service}`, apikey: service };

  const result = {
    posts: { total: 0, published: 0, drafts: 0, paywalled: 0 },
    subscribers: { total: 0, confirmed: 0, pending: 0 },
    revenue: { sales: 0, grossCents: 0, currency: 'usd', estimated: false },
  };

  // Posts (git content collection).
  try {
    const posts = await listPosts(env);
    result.posts.total = posts.length;
    result.posts.drafts = posts.filter((p) => p.draft).length;
    result.posts.published = result.posts.total - result.posts.drafts;
    // "Paywalled" = posts actually behind the paywall now (post_paywall.is_paid) — the
    // same definition the Posts manager badge and Revenue page use — NOT merely the
    // `gateable` frontmatter intent flag, so the three views agree.
    const paidSlugs = new Set();
    try {
      const r = await fetch(`${sb}/rest/v1/post_paywall?select=post_id,is_paid`, { headers: auth });
      if (r.ok) for (const row of await r.json()) if (row.is_paid === true) paidSlugs.add(row.post_id);
    } catch {
      /* paid annotation best-effort */
    }
    result.posts.paywalled = posts.filter((p) => paidSlugs.has(p.slug)).length;
  } catch {
    result.posts.error = true;
  }

  // Subscribers (exact counts via count=exact).
  async function count(filter) {
    try {
      const r = await fetch(`${sb}/rest/v1/subscribers?select=id${filter ? `&${filter}` : ''}`, {
        headers: { ...auth, Prefer: 'count=exact', Range: '0-0' },
      });
      const m = /\/(\d+)\s*$/.exec(r.headers.get('content-range') || '');
      return m ? parseInt(m[1], 10) : 0;
    } catch {
      return 0;
    }
  }
  const [subTotal, subConfirmed, subPending] = await Promise.all([
    count(''),
    count('status=eq.confirmed'),
    count('status=eq.pending'),
  ]);
  result.subscribers = { total: subTotal, confirmed: subConfirmed, pending: subPending };

  // Revenue (entitlements × paywall price estimate).
  try {
    const [entRes, pwRes] = await Promise.all([
      fetch(`${sb}/rest/v1/entitlements?select=*`, { headers: auth }),
      fetch(`${sb}/rest/v1/post_paywall?select=post_id,price_cents`, { headers: auth }),
    ]);
    const ents = entRes.ok ? await entRes.json() : [];
    const price = {};
    if (pwRes.ok) for (const r of await pwRes.json()) price[r.post_id] = r.price_cents;
    let gross = 0;
    let anyEstimated = false;
    for (const e of ents) {
      const captured = typeof e.amount_cents === 'number';
      gross += captured ? e.amount_cents : price[e.post_id] || 0;
      if (!captured) anyEstimated = true;
    }
    result.revenue = { sales: ents.length, grossCents: gross, currency: 'usd', estimated: anyEstimated };
  } catch {
    result.revenue.error = true;
  }

  return json(result);
}
