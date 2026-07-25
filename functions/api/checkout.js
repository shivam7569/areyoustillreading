// POST /api/checkout { postId } — creates a Dodo Payments hosted checkout for a
// paywalled post and returns { url }. Requires a signed-in user.

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export async function onRequestPost({ request, env }) {
  const sb = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const svc = { apikey: key, authorization: `Bearer ${key}` };

  // Authenticate the reader.
  const authz = request.headers.get('Authorization') || '';
  const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
  if (!token) return json({ error: 'Please sign in first.' }, 401);
  let user = null;
  try {
    const u = await fetch(`${sb}/auth/v1/user`, {
      headers: { apikey: key, authorization: `Bearer ${token}` },
    });
    if (u.ok) user = await u.json();
  } catch (e) {}
  if (!user || !user.id) return json({ error: 'Please sign in first.' }, 401);

  let postId = '';
  try {
    const b = await request.json();
    postId = b.postId;
  } catch (e) {}
  if (!postId) return json({ error: 'Missing post.' }, 400);

  // The post must currently be paywalled and have a Dodo product configured.
  let row = null;
  try {
    const r = await fetch(
      `${sb}/rest/v1/post_paywall?post_id=eq.${encodeURIComponent(postId)}&select=is_paid,product_id`,
      { headers: svc }
    );
    if (r.ok) row = (await r.json())[0];
  } catch (e) {}
  if (!row || !row.is_paid) return json({ error: 'This post is not for sale.' }, 400);
  if (!row.product_id) return json({ error: 'This post has no product configured yet.' }, 400);

  // Already purchased?
  try {
    const e = await fetch(
      `${sb}/rest/v1/entitlements?user_id=eq.${encodeURIComponent(user.id)}&post_id=eq.${encodeURIComponent(postId)}&select=id`,
      { headers: svc }
    );
    if (e.ok && (await e.json()).length > 0) return json({ error: 'You already own this post.' }, 400);
  } catch (e) {}

  // Create the Dodo checkout session.
  const base = env.DODO_API_BASE || 'https://test.dodopayments.com';
  const origin = new URL(request.url).origin;
  try {
    const res = await fetch(`${base}/checkouts`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.DODO_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        product_cart: [{ product_id: row.product_id, quantity: 1 }],
        customer: { email: user.email },
        return_url: `${origin}/blog/${postId}/?paid=1`,
        metadata: { post_id: postId, user_id: user.id },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('dodo checkout failed', res.status, JSON.stringify(data));
      return json({ error: 'Could not start checkout.' }, 502);
    }
    const url = data.checkout_url || data.url || data.payment_link;
    if (!url) return json({ error: 'No checkout URL returned.' }, 502);
    return json({ url });
  } catch (e) {
    console.error('checkout error', (e && e.message) || e);
    return json({ error: 'Checkout failed. Try again later.' }, 500);
  }
}
