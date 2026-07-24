// Server-side gate for /gated/<slug> full-content fragments.
// Free (not-paywalled) posts are served to anyone; paywalled posts require a valid
// Supabase user token AND an entitlement row. Fails safe (locked) on any error.

function locked() {
  return new Response('Locked', { status: 403, headers: { 'content-type': 'text/plain' } });
}

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const slug = url.pathname
    .replace(/^\/gated\//, '')
    .replace(/index\.html$/, '')
    .replace(/\/$/, '');
  if (!slug) return new Response('Not found', { status: 404 });

  const sb = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const svc = { apikey: key, authorization: `Bearer ${key}` };

  // Is this post currently paywalled?
  let paid = true; // fail safe
  try {
    const r = await fetch(
      `${sb}/rest/v1/post_paywall?post_id=eq.${encodeURIComponent(slug)}&select=is_paid`,
      { headers: svc }
    );
    if (r.ok) {
      const rows = await r.json();
      paid = rows.length > 0 && rows[0].is_paid === true;
    }
  } catch (e) {
    paid = true;
  }
  if (!paid) return next(); // free → serve

  // Paywalled: require a valid user token.
  const authz = request.headers.get('Authorization') || '';
  const userToken = authz.startsWith('Bearer ') ? authz.slice(7) : '';
  if (!userToken) return locked();

  let userId = '';
  try {
    const u = await fetch(`${sb}/auth/v1/user`, {
      headers: { apikey: key, authorization: `Bearer ${userToken}` },
    });
    if (u.ok) {
      const j = await u.json();
      userId = j.id || '';
    }
  } catch (e) {}
  if (!userId) return locked();

  // Admins can always read (to preview their own paywalled content).
  try {
    const a = await fetch(
      `${sb}/rest/v1/admins?user_id=eq.${encodeURIComponent(userId)}&select=user_id`,
      { headers: svc }
    );
    if (a.ok) {
      const rows = await a.json();
      if (rows.length > 0) return next();
    }
  } catch (e) {}

  // Entitlement check.
  let entitled = false;
  try {
    const e = await fetch(
      `${sb}/rest/v1/entitlements?user_id=eq.${encodeURIComponent(userId)}&post_id=eq.${encodeURIComponent(slug)}&select=id`,
      { headers: svc }
    );
    if (e.ok) {
      const rows = await e.json();
      entitled = rows.length > 0;
    }
  } catch (e) {}

  return entitled ? next() : locked();
}
