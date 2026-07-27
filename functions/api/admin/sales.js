/**
 * GET /api/admin/sales — the paywall sales ledger for the Revenue section.
 * Admin-gated. Reads public.entitlements with the service-role key (its SELECT
 * policy is own-only, so an admin cannot read the ledger from the browser at all)
 * and joins post_paywall.price_cents to ESTIMATE revenue.
 *
 * REVENUE IS AN ESTIMATE: entitlements records who owns what, not the amount paid
 * (see db/entitlements.sql), and price_cents can change after a sale. If a future
 * migration captures amount_cents onto entitlements, this endpoint prefers it.
 */
import { requireAdmin, json } from '../../../lib/require-admin.js';

export async function onRequestGet({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (!gate.ok) return json({ error: gate.error }, gate.status);

  const sb = env.SUPABASE_URL;
  const service = env.SUPABASE_SERVICE_ROLE_KEY;
  const auth = { Authorization: `Bearer ${service}`, apikey: service };

  let ents = [];
  const priceByPost = {};
  const curByPost = {};
  try {
    const [entRes, pwRes] = await Promise.all([
      fetch(`${sb}/rest/v1/entitlements?select=*&order=created_at.desc`, { headers: auth }),
      fetch(`${sb}/rest/v1/post_paywall?select=post_id,price_cents,currency`, { headers: auth }),
    ]);
    if (entRes.ok) ents = await entRes.json();
    if (pwRes.ok) {
      for (const row of await pwRes.json()) {
        priceByPost[row.post_id] = row.price_cents;
        curByPost[row.post_id] = row.currency;
      }
    }
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 502);
  }

  let totalCents = 0;
  let anyEstimated = false;
  const byPost = {};
  const sales = ents.map((e) => {
    const captured = typeof e.amount_cents === 'number';
    const cents = captured ? e.amount_cents : priceByPost[e.post_id] || 0;
    const currency = e.currency || curByPost[e.post_id] || 'usd';
    if (!captured) anyEstimated = true;
    totalCents += cents;
    if (!byPost[e.post_id]) byPost[e.post_id] = { post_id: e.post_id, count: 0, cents: 0 };
    byPost[e.post_id].count += 1;
    byPost[e.post_id].cents += cents;
    return { post_id: e.post_id, created_at: e.created_at, cents, currency, estimated: !captured };
  });

  return json({
    count: sales.length,
    totalCents,
    estimated: anyEstimated,
    sales,
    byPost: Object.values(byPost).sort((a, b) => b.cents - a.cents),
  });
}
