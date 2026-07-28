/**
 * POST /api/admin/early — give confirmed subscribers early access to a draft.
 * =============================================================================
 * Admin-gated. Mints an unguessable token that maps (in KV) to the post's slug,
 * then emails every confirmed subscriber a link to /early?t=<token> — which serves
 * the draft's already-rendered HTML (functions/early.js). The post stays a DRAFT
 * (not on public /blog) until the author publishes it for real. Reuses the Resend
 * batch + one-click-unsubscribe pattern.
 *
 * PRECONDITION: the draft's rendered HTML must already be in POSTS_HTML — i.e. the
 * author saved it as a draft from the editor (which stores the instant HTML). If
 * it's not there, we say so rather than emailing a broken link.
 *
 * Body: { slug, title, description? }.
 */
import { requireAdmin, json } from '../../../lib/require-admin.js';

const RESEND_BATCH_URL = 'https://api.resend.com/emails/batch';
const BATCH_SIZE = 100;
const EARLY_TTL_MS = 14 * 24 * 60 * 60 * 1000; // links valid for 14 days

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderEmail({ title, description, earlyUrl, unsubUrl, siteHost, mailAddress }) {
  const t = esc(title);
  const d = esc(description);
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f6f7f9;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;">
    <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#3a5bff;">Early access</p>
    <h1 style="margin:0 0 12px;font-size:24px;line-height:1.25;font-weight:700;letter-spacing:-0.02em;">
      <a href="${earlyUrl}" style="color:#111827;text-decoration:none;">${t}</a>
    </h1>
    ${d ? `<p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#374151;">${d}</p>` : ''}
    <p style="margin:0 0 8px;">
      <a href="${earlyUrl}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 22px;border-radius:8px;">Read it early &rarr;</a>
    </p>
    <p style="margin:14px 0 0;font-size:13px;color:#9ca3af;">A subscriber-only preview — please keep the link to yourself.</p>
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0 16px;" />
    <p style="margin:0;font-size:13px;line-height:1.6;color:#9ca3af;">
      You&rsquo;re receiving this because you subscribed at ${esc(siteHost)}.<br/>
      ${mailAddress ? esc(mailAddress) + '<br/>' : ''}<a href="${unsubUrl}" style="color:#9ca3af;text-decoration:underline;">Unsubscribe</a>
    </p>
  </div>
</body></html>`;
  const text = `Early access — ${title}\n\n${description ? description + '\n\n' : ''}Read it early: ${earlyUrl}\n(A subscriber-only preview — please keep the link to yourself.)\n\n—\nYou're receiving this because you subscribed at ${siteHost}.\n${mailAddress ? mailAddress + '\n' : ''}Unsubscribe: ${unsubUrl}`;
  return { html, text };
}

export async function onRequestPost(ctx) {
  try {
    return await handle(ctx);
  } catch (e) {
    return json({ error: 'Early access failed: ' + String((e && e.message) || e) }, 400);
  }
}

async function handle({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (!gate.ok) return json({ error: gate.error }, gate.status);

  const kv = env.POSTS_HTML;
  if (!kv) return json({ error: 'Server not configured (POSTS_HTML).' }, 400);
  if (!env.RESEND_API_KEY) return json({ error: 'Email is not configured (RESEND_API_KEY).' }, 400);
  const sb = env.SUPABASE_URL;
  const service = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sb || !service) return json({ error: 'Server not configured (Supabase).' }, 400);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const { slug, title, description } = body || {};
  if (typeof slug !== 'string' || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug)) return json({ error: 'Invalid slug' }, 400);
  if (typeof title !== 'string' || !title.trim()) return json({ error: 'Missing title' }, 400);

  // The draft must already have rendered HTML in the overlay (saved from the editor).
  const entryRaw = await kv.get(slug);
  if (!entryRaw) return json({ error: 'No rendered draft found — open it in the editor and Save as a draft first.' }, 400);

  const site = (env.SITE_URL || 'https://areyoustillreading.dev').replace(/\/+$/, '');
  const siteHost = site.replace(/^https?:\/\//, '');
  const from = env.EMAIL_FROM || 'areyoustillreading <hello@areyoustillreading.dev>';
  const mailAddress = env.MAIL_ADDRESS || '';
  const desc = typeof description === 'string' ? description.trim() : '';

  // Mint a shared, unguessable token (one link for all subscribers) with a TTL.
  const token = crypto.randomUUID().replace(/-/g, '');
  const earlyUrl = `${site}/early?t=${token}`;
  await kv.put(
    `early:${token}`,
    JSON.stringify({ slug, title, exp: Date.now() + EARLY_TTL_MS }),
    { expirationTtl: Math.ceil(EARLY_TTL_MS / 1000) + 3600 },
  );

  // Confirmed subscribers only.
  const auth = { Authorization: `Bearer ${service}`, apikey: service };
  const lr = await fetch(`${sb}/rest/v1/subscribers?status=eq.confirmed&select=email,unsubscribe_token`, { headers: auth });
  if (!lr.ok) return json({ error: `Could not load subscribers (${lr.status})` }, 400);
  let subs = await lr.json();
  subs = (Array.isArray(subs) ? subs : []).filter((s) => s && s.email && s.unsubscribe_token);
  if (subs.length === 0) return json({ ok: true, sent: 0, url: earlyUrl, message: 'No confirmed subscribers yet' });

  let sent = 0;
  let failed = 0;
  for (let i = 0; i < subs.length; i += BATCH_SIZE) {
    const chunk = subs.slice(i, i + BATCH_SIZE);
    const batch = chunk.map((s) => {
      const unsubUrl = `${site}/api/unsubscribe?token=${s.unsubscribe_token}`;
      const { html, text } = renderEmail({ title, description: desc, earlyUrl, unsubUrl, siteHost, mailAddress });
      return {
        from, to: [s.email], subject: `Early access: ${title}`, html, text,
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
        console.error('early batch failed', r.status, (await r.text()).slice(0, 200));
      }
    } catch (e) {
      failed += chunk.length;
      console.error('early batch error', (e && e.message) || e);
    }
  }

  if (sent === 0) return json({ error: `Early-access email failed to send to all ${failed} subscribers.`, sent: 0, failed }, 400);
  return json({ ok: true, sent, failed, url: earlyUrl });
}
