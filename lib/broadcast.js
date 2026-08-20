/**
 * lib/broadcast.js — the shared "email a new post to confirmed subscribers" engine.
 * =============================================================================
 * Extracted from functions/api/admin/broadcast.js so BOTH publish paths reuse the exact
 * same send + idempotency logic:
 *   - the FILE path (owner, /api/admin/broadcast): postUrl = /blog/<slug>/, guard broadcast:<slug>
 *   - the DB path (author, /api/author/publish):   postUrl = /@handle/slug,  guard broadcast:<uuid>
 * The caller decides the postUrl and the guardKey (a per-author DB slug isn't globally unique,
 * so DB posts guard by the post UUID); everything else — the double-send KV guard, the confirmed-
 * subscriber load, the per-recipient one-click unsubscribe link, the Resend batch send, the
 * partial-failure retry state — is identical. See the admin endpoint's header for the full
 * idempotency + fail-closed rationale.
 *
 * broadcastPost(env, { postUrl, guardKey, title, description?, force?, retry? })
 *   -> Promise<{ status: number, body: object }>   (the caller wraps body in a Response)
 * Fail-CLOSED like the original: no double-send guard (POSTS_HTML unbound) and not forced -> refuse.
 */

const RESEND_BATCH_URL = 'https://api.resend.com/emails/batch';
const BATCH_SIZE = 100;
const STALE_MS = 10 * 60 * 1000;

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Build the { html, text } body for one recipient (tiny + inline-styled for mail clients).
function renderEmail({ title, description, postUrl, unsubUrl, siteHost, mailAddress }) {
  const t = esc(title);
  const d = esc(description);
  const addrHtml = mailAddress ? `${esc(mailAddress)}<br/>` : '';
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f6f7f9;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;">
    <p style="margin:0 0 24px;font-size:14px;font-weight:600;letter-spacing:-0.01em;color:#6b7280;">areyoustillreading</p>
    <h1 style="margin:0 0 12px;font-size:24px;line-height:1.25;font-weight:700;letter-spacing:-0.02em;">
      <a href="${postUrl}" style="color:#111827;text-decoration:none;">${t}</a>
    </h1>
    ${d ? `<p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#374151;">${d}</p>` : ''}
    <p style="margin:0 0 32px;">
      <a href="${postUrl}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 22px;border-radius:8px;">Read the post &rarr;</a>
    </p>
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:0 0 16px;" />
    <p style="margin:0;font-size:13px;line-height:1.6;color:#9ca3af;">
      You&rsquo;re receiving this because you subscribed at ${esc(siteHost)}.<br/>
      ${addrHtml}<a href="${unsubUrl}" style="color:#9ca3af;text-decoration:underline;">Unsubscribe</a>
    </p>
  </div>
</body></html>`;
  const text = `${title}\n\n${description ? description + '\n\n' : ''}Read the post: ${postUrl}\n\n—\nYou're receiving this because you subscribed at ${siteHost}.\n${mailAddress ? mailAddress + '\n' : ''}Unsubscribe: ${unsubUrl}`;
  return { html, text };
}

// Send `recipients` ([{email, unsubscribe_token}]) via Resend batch (<=100/call).
async function sendBatches(recipients, ctx) {
  const { env, from, title, desc, postUrl, siteHost, mailAddress, site } = ctx;
  let sent = 0, failed = 0;
  const failedRecipients = [];
  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    const chunk = recipients.slice(i, i + BATCH_SIZE);
    const batch = chunk.map((s) => {
      const unsubUrl = `${site}/api/unsubscribe?token=${s.unsubscribe_token}`;
      const { html, text } = renderEmail({ title, description: desc, postUrl, unsubUrl, siteHost, mailAddress });
      return {
        from, to: [s.email], subject: `New post: ${title}`, html, text,
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
        let okCount = chunk.length;
        try { const jr = await r.json(); if (jr && Array.isArray(jr.data)) okCount = jr.data.filter((x) => x && x.id).length; } catch {}
        okCount = Math.max(0, Math.min(chunk.length, okCount));
        sent += okCount;
        failed += chunk.length - okCount;
      } else {
        failed += chunk.length;
        for (const s of chunk) failedRecipients.push(s);
        console.error('resend batch failed', r.status, (await r.text()).slice(0, 300));
      }
    } catch (e) {
      failed += chunk.length;
      for (const s of chunk) failedRecipients.push(s);
      console.error('resend batch error', (e && e.message) || e);
    }
  }
  return { sent, failed, failedRecipients };
}

/**
 * Send the announcement. postUrl + guardKey are supplied by the caller (file vs DB path).
 * Returns { status, body } — body is the JSON the caller returns to its client.
 */
export async function broadcastPost(env, { postUrl, guardKey, title, description = '', force = false, retry = false }) {
  if (typeof title !== 'string' || !title.trim()) return { status: 400, body: { error: 'Missing title' } };
  if (typeof postUrl !== 'string' || !postUrl) return { status: 400, body: { error: 'Missing postUrl' } };
  if (typeof guardKey !== 'string' || !guardKey) return { status: 400, body: { error: 'Missing guardKey' } };
  if (!env.RESEND_API_KEY) return { status: 400, body: { error: 'Email is not configured (RESEND_API_KEY).' } };
  const sb = env.SUPABASE_URL, service = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sb || !service) return { status: 400, body: { error: 'Server not configured (Supabase).' } };
  const auth = { Authorization: `Bearer ${service}`, apikey: service };

  const site = (env.SITE_URL || 'https://areyoustillreading.dev').replace(/\/+$/, '');
  const siteHost = site.replace(/^https?:\/\//, '');
  const from = env.EMAIL_FROM || 'areyoustillreading <hello@areyoustillreading.dev>';
  const mailAddress = env.MAIL_ADDRESS || '';
  const desc = typeof description === 'string' ? description.trim() : '';
  const ctx = { env, from, title, desc, postUrl, siteHost, mailAddress, site };
  const kv = env.POSTS_HTML;

  // --- Retry path: re-send ONLY the recipients a prior send failed on --------
  if (retry === true) {
    if (!kv) return { status: 400, body: { error: 'Retry needs the guard store (POSTS_HTML).' } };
    let prev = {};
    try { prev = JSON.parse((await kv.get(guardKey)) || '{}') || {}; } catch {}
    const failedEmails = Array.isArray(prev.failedEmails) ? prev.failedEmails : [];
    if (failedEmails.length === 0) return { status: 200, body: { ok: true, retried: true, sent: 0, failed: 0, message: 'Nothing to retry.' } };
    const inClause = failedEmails.slice(0, 2000).map((e) => JSON.stringify(String(e))).join(',');
    const rq = await fetch(`${sb}/rest/v1/subscribers?status=eq.confirmed&email=in.(${encodeURIComponent(inClause)})&select=email,unsubscribe_token`, { headers: auth });
    if (!rq.ok) return { status: 400, body: { error: `Could not load subscribers (${rq.status})` } };
    let recips = await rq.json();
    recips = (Array.isArray(recips) ? recips : []).filter((s) => s && s.email && s.unsubscribe_token);
    if (recips.length === 0) {
      try { await kv.put(guardKey, JSON.stringify({ ...prev, failedEmails: [], failed: 0 }), { metadata: { status: 'sent', sentAt: prev.sentAt || null, sent: prev.sent || 0, failed: 0 } }); } catch {}
      return { status: 200, body: { ok: true, retried: true, sent: 0, failed: 0, message: 'No retriable subscribers remain.' } };
    }
    const res = await sendBatches(recips, ctx);
    const stillFailed = res.failedRecipients.map((r) => r.email);
    const sentAt = new Date().toISOString();
    const totalSent = (prev.sent || 0) + res.sent;
    try { await kv.put(guardKey, JSON.stringify({ status: 'sent', sentAt, sent: totalSent, failed: stillFailed.length, failedEmails: stillFailed, title: prev.title || title }), { metadata: { status: 'sent', sentAt, sent: totalSent, failed: stillFailed.length } }); } catch {}
    return { status: 200, body: { ok: true, retried: true, sent: res.sent, failed: stillFailed.length, remaining: stillFailed.length } };
  }

  // --- Idempotency guard (fail-closed) --------------------------------------
  if (!kv && !force) return { status: 400, body: { error: 'Double-send guard unavailable (POSTS_HTML unbound); refusing to broadcast. Pass force:true to override.' } };
  if (kv && !force) {
    const prior = await kv.get(guardKey);
    if (prior) {
      let p = {};
      try { p = JSON.parse(prior) || {}; } catch {}
      if (p.status === 'sent') return { status: 200, body: { ok: true, sent: 0, skipped: 'already-sent', sentAt: p.sentAt || null, count: p.sent || 0 } };
      const startedMs = p.startedAt ? Date.parse(p.startedAt) : 0;
      if (p.status === 'sending' && Date.now() - startedMs < STALE_MS) return { status: 200, body: { ok: true, sent: 0, skipped: 'in-progress' } };
    }
  }

  // --- Load confirmed subscribers -------------------------------------------
  const listRes = await fetch(`${sb}/rest/v1/subscribers?status=eq.confirmed&select=email,unsubscribe_token`, { headers: auth });
  if (!listRes.ok) return { status: 400, body: { error: `Could not load subscribers (${listRes.status})` } };
  let subs = await listRes.json();
  subs = (Array.isArray(subs) ? subs : []).filter((s) => s && s.email && s.unsubscribe_token);
  if (subs.length === 0) return { status: 200, body: { ok: true, sent: 0, message: 'No confirmed subscribers yet' } };

  if (kv) { try { await kv.put(guardKey, JSON.stringify({ status: 'sending', startedAt: new Date().toISOString(), title }), { metadata: { status: 'sending' } }); } catch {} }

  const { sent, failed, failedRecipients } = await sendBatches(subs, ctx);
  const failedEmails = failedRecipients.map((r) => r.email);

  if (sent === 0) {
    if (kv) { try { await kv.delete(guardKey); } catch {} }
    return { status: 400, body: { error: `Email failed to send to all ${failed} subscriber${failed === 1 ? '' : 's'}. Nobody was notified — re-publish to retry.`, sent: 0, failed } };
  }
  if (kv) {
    try {
      const sentAt = new Date().toISOString();
      await kv.put(guardKey, JSON.stringify({ status: 'sent', sentAt, sent, failed, failedEmails, title }), { metadata: { status: 'sent', sentAt, sent, failed } });
    } catch {}
  }
  return { status: 200, body: { ok: true, sent, failed, total: subs.length } };
}
