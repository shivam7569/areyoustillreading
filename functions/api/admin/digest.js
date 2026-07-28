/**
 * POST /api/admin/digest — email a roundup of recent posts to confirmed subscribers.
 * =============================================================================
 * Admin-triggered (Cloudflare Pages has no cron, so the author sends when they
 * want — a weekly/monthly cadence at their discretion). Reuses the same email
 * primitives as the per-post broadcast: Resend batch (<=100/call, permissive),
 * a per-recipient one-click unsubscribe link + List-Unsubscribe headers, and the
 * confirmed-only subscriber list. A soft KV guard blocks an accidental re-send
 * within an hour (override with force:true).
 *
 * Body: { count?: 1-10 (default 5), intro?: string, force?: bool }.
 * Env: RESEND_API_KEY, SUPABASE_*, GITHUB_* (listPosts), POSTS_HTML (soft guard),
 *      SITE_URL/EMAIL_FROM/MAIL_ADDRESS (optional).
 */
import { requireAdmin, json } from '../../../lib/require-admin.js';
import { listPosts } from '../../../lib/list-posts.js';

const RESEND_BATCH_URL = 'https://api.resend.com/emails/batch';
const BATCH_SIZE = 100;

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderDigest({ posts, site, siteHost, unsubUrl, mailAddress, intro }) {
  const items = posts.map((p) => `
    <div style="margin:0 0 20px;">
      <a href="${site}/blog/${p.slug}/" style="font-size:17px;font-weight:700;letter-spacing:-0.01em;color:#111827;text-decoration:none;">${esc(p.title)}</a>
      ${p.description ? `<p style="margin:4px 0 0;font-size:14px;line-height:1.55;color:#374151;">${esc(p.description)}</p>` : ''}
    </div>`).join('');
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f6f7f9;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;">
    <p style="margin:0 0 20px;font-size:14px;font-weight:600;letter-spacing:-0.01em;color:#6b7280;">areyoustillreading</p>
    ${intro ? `<p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#374151;">${esc(intro)}</p>` : ''}
    ${items}
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0 16px;" />
    <p style="margin:0;font-size:13px;line-height:1.6;color:#9ca3af;">
      You&rsquo;re receiving this because you subscribed at ${esc(siteHost)}.<br/>
      ${mailAddress ? esc(mailAddress) + '<br/>' : ''}<a href="${unsubUrl}" style="color:#9ca3af;text-decoration:underline;">Unsubscribe</a>
    </p>
  </div>
</body></html>`;
  const text = `${intro ? intro + '\n\n' : ''}${posts.map((p) => `${p.title}\n${site}/blog/${p.slug}/`).join('\n\n')}\n\n—\nYou're receiving this because you subscribed at ${siteHost}.\n${mailAddress ? mailAddress + '\n' : ''}Unsubscribe: ${unsubUrl}`;
  return { html, text };
}

export async function onRequestPost(ctx) {
  try {
    return await handle(ctx);
  } catch (e) {
    return json({ error: 'Digest failed: ' + String((e && e.message) || e) }, 400);
  }
}

async function handle({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (!gate.ok) return json({ error: gate.error }, gate.status);

  if (!env.RESEND_API_KEY) return json({ error: 'Email is not configured (RESEND_API_KEY).' }, 400);
  const sb = env.SUPABASE_URL;
  const service = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sb || !service) return json({ error: 'Server not configured (Supabase).' }, 400);

  let body;
  try { body = await request.json(); } catch { body = {}; }
  const count = Math.max(1, Math.min(10, parseInt(body.count, 10) || 5));
  const intro = typeof body.intro === 'string' ? body.intro.trim().slice(0, 600) : '';
  const force = body.force === true;

  const site = (env.SITE_URL || 'https://areyoustillreading.dev').replace(/\/+$/, '');
  const siteHost = site.replace(/^https?:\/\//, '');
  const from = env.EMAIL_FROM || 'areyoustillreading <hello@areyoustillreading.dev>';
  const mailAddress = env.MAIL_ADDRESS || '';

  // Soft guard: block an accidental re-send within an hour.
  const kv = env.POSTS_HTML;
  if (kv && !force) {
    const last = await kv.get('digest:last');
    if (last) {
      const ms = Date.parse(last);
      if (Number.isFinite(ms) && Date.now() - ms < 3600000) {
        return json({ error: 'A digest was already sent within the last hour. Re-send with force to override.', recentlySent: true }, 400);
      }
    }
  }

  // Recent published posts (newest-first from the git catalog).
  let posts;
  try { posts = await listPosts(env); } catch (e) { return json({ error: String((e && e.message) || e) }, 400); }
  posts = (posts || []).filter((p) => !p.draft).slice(0, count);
  if (posts.length === 0) return json({ error: 'No published posts to include.' }, 400);

  // Confirmed subscribers.
  const auth = { Authorization: `Bearer ${service}`, apikey: service };
  const lr = await fetch(`${sb}/rest/v1/subscribers?status=eq.confirmed&select=email,unsubscribe_token`, { headers: auth });
  if (!lr.ok) return json({ error: `Could not load subscribers (${lr.status})` }, 400);
  let subs = await lr.json();
  subs = (Array.isArray(subs) ? subs : []).filter((s) => s && s.email && s.unsubscribe_token);
  if (subs.length === 0) return json({ ok: true, sent: 0, message: 'No confirmed subscribers yet' });

  const subject = posts.length === 1
    ? `New: ${posts[0].title}`
    : `${posts.length} recent posts from areyoustillreading`;

  let sent = 0;
  let failed = 0;
  for (let i = 0; i < subs.length; i += BATCH_SIZE) {
    const chunk = subs.slice(i, i + BATCH_SIZE);
    const batch = chunk.map((s) => {
      const unsubUrl = `${site}/api/unsubscribe?token=${s.unsubscribe_token}`;
      const { html, text } = renderDigest({ posts, site, siteHost, unsubUrl, mailAddress, intro });
      return {
        from, to: [s.email], subject, html, text,
        headers: { 'List-Unsubscribe': `<${unsubUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      };
    });
    try {
      const r = await fetch(RESEND_BATCH_URL, {
        method: 'POST',
        headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json', 'x-batch-validation': 'permissive' },
        body: JSON.stringify(batch),
        signal: AbortSignal.timeout(20000),
      });
      if (r.ok) {
        let ok = chunk.length;
        try { const jr = await r.json(); if (jr && Array.isArray(jr.data)) ok = jr.data.filter((x) => x && x.id).length; } catch {}
        ok = Math.max(0, Math.min(chunk.length, ok));
        sent += ok;
        failed += chunk.length - ok;
      } else {
        failed += chunk.length;
        console.error('digest batch failed', r.status, (await r.text()).slice(0, 200));
      }
    } catch (e) {
      failed += chunk.length;
      console.error('digest batch error', (e && e.message) || e);
    }
  }

  if (sent === 0) return json({ error: `Digest failed to send to all ${failed} subscribers.`, sent: 0, failed }, 400);
  if (kv) { try { await kv.put('digest:last', new Date().toISOString()); } catch {} }
  return json({ ok: true, sent, failed, posts: posts.length });
}
