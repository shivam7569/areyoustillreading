/**
 * POST /api/admin/broadcast — email a "new post" announcement to every CONFIRMED
 * newsletter subscriber. Admin-gated.
 * =============================================================================
 *
 * WHAT / RESPONSIBILITY
 *   One Cloudflare Pages Function (route /api/admin/broadcast). Given a just-
 *   published post's { slug, title, description }, it:
 *     1. verifies the caller is an admin (shared requireAdmin gate),
 *     2. refuses to blast the same post twice (idempotency guard, see below),
 *     3. loads all status='confirmed' subscribers with their per-row unsubscribe
 *        token (service-role read; the table is RLS-locked to the anon key),
 *     4. sends one email per recipient via Resend's batch API (<=100 per call,
 *        permissive validation) each carrying that recipient's own one-click
 *        unsubscribe link + List-Unsubscribe headers,
 *     5. records the send so a re-publish (typo fix) won't re-notify everyone.
 *   It does NOT publish, render, or gate content — it only announces an already-
 *   published post. The editor calls it AFTER /api/publish succeeds, and only
 *   when the author ticked "Email subscribers" (never for a draft).
 *
 * WHERE IT SITS
 *   Admin editor publish flow (src/pages/admin/write.astro)
 *     -> POST /api/publish        (commit + instant KV overlay)      [must succeed]
 *     -> POST /api/admin/broadcast (this file; optional, opt-in)     [announce]
 *   Subscribers live in Supabase public.subscribers (double opt-in; see
 *   db/schema.sql). The unsubscribe link is redeemed by functions/api/unsubscribe.js
 *   (a non-mutating GET confirm page + a POST that actually unsubscribes, which
 *   also serves the RFC 8058 one-click header advertised here).
 *
 * IDEMPOTENCY (the "don't double-send" guard)
 *   Keyed in the SAME Cloudflare KV namespace the instant-publish overlay uses
 *   (env.POSTS_HTML) under `broadcast:<slug>`. We RESERVE the slug (status
 *   'sending') BEFORE the send and finalize it (status 'sent') after, so a second
 *   invocation for the same slug on the same edge sees the in-flight reservation
 *   and backs off — closing the realistic (double-click / retry) concurrency
 *   window. A crashed send leaves a stale 'sending' reservation; anything older
 *   than STALE_MS is treated as abandoned and may be overwritten. On a TOTAL send
 *   failure we DELETE the reservation so a corrected re-publish can retry cleanly.
 *   FAIL-CLOSED: if the KV guard binding is missing we refuse to broadcast (a
 *   send with no double-send protection is never silently allowed) unless the
 *   caller explicitly passes force:true. `force:true` also overrides an existing
 *   guard for a deliberate re-send.
 *   RESIDUAL: Cloudflare KV is eventually consistent, so two publishes of the same
 *   slug from DIFFERENT edges within ~60s could still both send. That window is
 *   negligible for a single author (the editor also awaits the call and disables
 *   the publish button); if the operator base ever grows, swap this guard for an
 *   atomic Supabase unique-constraint reservation — the send logic is unchanged.
 *
 * SECURITY / RESILIENCE
 *   - Admin-gated by the shared fail-closed requireAdmin (Supabase Bearer ->
 *     public.admins via service role). No admin => no send.
 *   - Handled errors return 4xx (NOT 5xx): Cloudflare replaces a Function's 5xx
 *     with its own "Bad gateway" HTML, which the editor could not parse — see the
 *     cloudflare-5xx-masking note. So the author always sees the real reason. A
 *     TOTAL send failure is reported as an ERROR (4xx), never as success.
 *   - title/description are admin-authored but still HTML-escaped before going
 *     into the email markup, so odd characters can't break the template.
 *   - The whole handler is wrapped so any unexpected throw becomes a readable 400.
 *
 * SCALING NOTE
 *   Sends inline (batched 100/call) so the author gets an exact "emailed N"
 *   count. Fine for hundreds—low thousands of subscribers. If the list ever grows
 *   past what fits one request's time budget, move the send to a queue/Durable
 *   Object and return an async job id; the guard + per-recipient link logic here
 *   transfer unchanged.
 *
 * Env (Cloudflare Pages project settings):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — subscriber read + admin check   [bound]
 *   RESEND_API_KEY                          — Resend transactional/batch API   [bound]
 *   POSTS_HTML (KV binding)                 — the idempotency guard store       [bound]
 *   SITE_URL, EMAIL_FROM (optional)         — safe production defaults below
 *   MAIL_ADDRESS (optional but recommended) — physical postal address shown in
 *       the email footer (CAN-SPAM / CASL requirement for commercial mail). If
 *       unset the line is omitted; set it before sending to real recipients.
 */
import { requireAdmin, json } from '../../../lib/require-admin.js';

// Resend batch endpoint: send up to 100 fully-formed emails in one call. We build
// one object PER recipient (each with its own unsubscribe link), so we chunk the
// confirmed list into groups of this size.
const RESEND_BATCH_URL = 'https://api.resend.com/emails/batch';
const BATCH_SIZE = 100;
// A reservation left 'sending' longer than this is assumed to be from a crashed
// invocation and may be overwritten (so a real crash can't wedge a slug forever).
const STALE_MS = 10 * 60 * 1000;

// Minimal HTML escape for the admin-authored title/description. The admin is
// trusted, but escaping keeps a stray < or & from breaking the email markup.
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Build the { html, text } body for one recipient. Kept tiny and inline-styled so
// it renders consistently across mail clients (no external CSS in email). The only
// per-recipient difference is unsubUrl, so this is called once per subscriber.
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

// Send `recipients` ([{email, unsubscribe_token}]) via Resend batch (<=100/call),
// each with its own one-click unsubscribe link. Returns { sent, failed, failedRecipients }
// where failedRecipients are the members of any chunk that failed WHOLESALE (network /
// timeout / non-2xx) — i.e. the ones worth retrying. Within-chunk address rejections
// (permissive mode) are counted in `failed` but not retried (a bad address won't fix
// itself on a resend), so `sent`/`failed` stay truthful while retries target real gaps.
async function sendBatches(recipients, ctx) {
  const { env, from, title, desc, postUrl, siteHost, mailAddress, site } = ctx;
  let sent = 0;
  let failed = 0;
  const failedRecipients = [];
  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    const chunk = recipients.slice(i, i + BATCH_SIZE);
    const batch = chunk.map((s) => {
      const unsubUrl = `${site}/api/unsubscribe?token=${s.unsubscribe_token}`;
      const { html, text } = renderEmail({ title, description: desc, postUrl, unsubUrl, siteHost, mailAddress });
      return {
        from,
        to: [s.email],
        subject: `New post: ${title}`,
        html,
        text,
        headers: {
          'List-Unsubscribe': `<${unsubUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      };
    });
    try {
      const r = await fetch(RESEND_BATCH_URL, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${env.RESEND_API_KEY}`,
          'content-type': 'application/json',
          'x-batch-validation': 'permissive',
        },
        body: JSON.stringify(batch),
        signal: AbortSignal.timeout(20000),
      });
      if (r.ok) {
        let okCount = chunk.length;
        try {
          const jr = await r.json();
          if (jr && Array.isArray(jr.data)) okCount = jr.data.filter((x) => x && x.id).length;
        } catch { /* keep the optimistic default */ }
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

// Outer wrapper: any unexpected throw becomes a readable 400 (never a 5xx that
// Cloudflare would mask into an opaque "Bad gateway").
export async function onRequestPost(ctx) {
  try {
    return await handleBroadcast(ctx);
  } catch (e) {
    return json({ error: 'Broadcast failed: ' + String((e && e.message) || e) }, 400);
  }
}

async function handleBroadcast({ request, env }) {
  // --- Auth: caller must be a signed-in admin -------------------------------
  const gate = await requireAdmin(request, env);
  if (!gate.ok) return json({ error: gate.error }, gate.status);

  // --- Parse + validate -----------------------------------------------------
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const { slug, title, description, force, retry } = body || {};
  if (typeof slug !== 'string' || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug)) {
    return json({ error: 'Invalid slug' }, 400);
  }
  if (typeof title !== 'string' || !title.trim()) {
    return json({ error: 'Missing title' }, 400);
  }
  const desc = typeof description === 'string' ? description.trim() : '';

  if (!env.RESEND_API_KEY) return json({ error: 'Email is not configured (RESEND_API_KEY).' }, 400);
  const sb = env.SUPABASE_URL;
  const service = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sb || !service) return json({ error: 'Server not configured (Supabase).' }, 400);
  const auth = { Authorization: `Bearer ${service}`, apikey: service };

  const site = (env.SITE_URL || 'https://areyoustillreading.dev').replace(/\/+$/, '');
  const siteHost = site.replace(/^https?:\/\//, '');
  const from = env.EMAIL_FROM || 'areyoustillreading <hello@areyoustillreading.dev>';
  const mailAddress = env.MAIL_ADDRESS || '';
  const postUrl = `${site}/blog/${slug}/`;
  // Shared render/send context for sendBatches (normal + retry paths).
  const ctx = { env, from, title, desc, postUrl, siteHost, mailAddress, site };

  const kv = env.POSTS_HTML; // reuse the instant-publish namespace
  const guardKey = `broadcast:${slug}`;

  // --- Retry path: re-send ONLY the recipients a prior send failed on --------
  if (retry === true) {
    if (!kv) return json({ error: 'Retry needs the guard store (POSTS_HTML).' }, 400);
    let prev = {};
    try { prev = JSON.parse((await kv.get(guardKey)) || '{}') || {}; } catch { /* corrupt */ }
    const failedEmails = Array.isArray(prev.failedEmails) ? prev.failedEmails : [];
    if (failedEmails.length === 0) {
      return json({ ok: true, retried: true, sent: 0, failed: 0, message: 'Nothing to retry.' });
    }
    // Re-fetch those subscribers (still confirmed) for their current unsubscribe tokens.
    const inClause = failedEmails.slice(0, 2000).map((e) => JSON.stringify(String(e))).join(',');
    const rq = await fetch(
      `${sb}/rest/v1/subscribers?status=eq.confirmed&email=in.(${encodeURIComponent(inClause)})&select=email,unsubscribe_token`,
      { headers: auth },
    );
    if (!rq.ok) return json({ error: `Could not load subscribers (${rq.status})` }, 400);
    let recips = await rq.json();
    recips = (Array.isArray(recips) ? recips : []).filter((s) => s && s.email && s.unsubscribe_token);
    if (recips.length === 0) {
      // The failed addresses are no longer confirmed subscribers — clear them.
      try { await kv.put(guardKey, JSON.stringify({ ...prev, failedEmails: [], failed: 0 }), { metadata: { status: 'sent', sentAt: prev.sentAt || null, sent: prev.sent || 0, failed: 0 } }); } catch {}
      return json({ ok: true, retried: true, sent: 0, failed: 0, message: 'No retriable subscribers remain.' });
    }
    const res = await sendBatches(recips, ctx);
    const stillFailed = res.failedRecipients.map((r) => r.email);
    const sentAt = new Date().toISOString();
    const totalSent = (prev.sent || 0) + res.sent;
    try {
      await kv.put(
        guardKey,
        JSON.stringify({ status: 'sent', sentAt, sent: totalSent, failed: stillFailed.length, failedEmails: stillFailed, title: prev.title || title }),
        { metadata: { status: 'sent', sentAt, sent: totalSent, failed: stillFailed.length } },
      );
    } catch { /* best-effort */ }
    return json({ ok: true, retried: true, sent: res.sent, failed: stillFailed.length, remaining: stillFailed.length });
  }

  // --- Idempotency guard: reserve the slug before sending -------------------
  // FAIL-CLOSED: never broadcast without a double-send guard unless explicitly forced.
  if (!kv && !force) {
    return json({ error: 'Double-send guard unavailable (POSTS_HTML unbound); refusing to broadcast. Pass force:true to override.' }, 400);
  }
  if (kv && !force) {
    const prior = await kv.get(guardKey);
    if (prior) {
      let p = {};
      try { p = JSON.parse(prior) || {}; } catch { /* corrupt → treat as already-sent */ }
      if (p.status === 'sent') {
        return json({ ok: true, sent: 0, skipped: 'already-sent', sentAt: p.sentAt || null, count: p.sent || 0 });
      }
      // A reservation still 'sending' means another invocation is mid-flight —
      // back off, unless it's stale enough to be a crashed run we can reclaim.
      const startedMs = p.startedAt ? Date.parse(p.startedAt) : 0;
      if (p.status === 'sending' && Date.now() - startedMs < STALE_MS) {
        return json({ ok: true, sent: 0, skipped: 'in-progress' });
      }
    }
  }

  // --- Load confirmed subscribers (email + per-row unsubscribe token) --------
  // Only 'confirmed' rows ever get mail (double opt-in); pending/unsubscribed are
  // excluded by the filter. unsubscribe_token is NOT NULL in the schema, so every
  // row yields a valid one-click link. (`auth` is defined once near the top.)
  const listRes = await fetch(
    `${sb}/rest/v1/subscribers?status=eq.confirmed&select=email,unsubscribe_token`,
    { headers: auth },
  );
  if (!listRes.ok) {
    return json({ error: `Could not load subscribers (${listRes.status})` }, 400);
  }
  let subs = await listRes.json();
  subs = (Array.isArray(subs) ? subs : []).filter((s) => s && s.email && s.unsubscribe_token);

  // Nothing to send — and we intentionally reserve NOTHING, so a later publish
  // (once people have subscribed) can still announce this post.
  if (subs.length === 0) {
    return json({ ok: true, sent: 0, message: 'No confirmed subscribers yet' });
  }

  // Reserve the slug (best-effort) so a concurrent same-slug publish backs off.
  // Mirror the status into KV metadata so the Posts panel can read send-state via
  // a single list({prefix:'broadcast:'}) without a get() per post.
  if (kv) {
    try { await kv.put(guardKey, JSON.stringify({ status: 'sending', startedAt: new Date().toISOString(), title }), { metadata: { status: 'sending' } }); } catch { /* reservation is best-effort */ }
  }

  // --- Send via Resend batch (<=100/call), per-recipient unsubscribe link -----
  const { sent, failed, failedRecipients } = await sendBatches(subs, ctx);
  const failedEmails = failedRecipients.map((r) => r.email);

  // --- Finalize the guard ---------------------------------------------------
  // TOTAL failure (nobody reached): release the reservation and report an ERROR so
  // the author knows the announcement did NOT go out and a re-publish will retry.
  if (sent === 0) {
    if (kv) { try { await kv.delete(guardKey); } catch { /* best-effort release */ } }
    return json({ error: `Email failed to send to all ${failed} subscriber${failed === 1 ? '' : 's'}. Nobody was notified — re-publish to retry.`, sent: 0, failed }, 400);
  }
  // Reached at least one recipient: record the send so a re-publish won't re-blast.
  // On a PARTIAL failure the guard is still written (don't re-mail the ones who got
  // it), but we persist `failedEmails` so a targeted "retry failed" re-sends ONLY to
  // the gaps. `failed` is mirrored into KV metadata so the Posts panel can offer it.
  if (kv) {
    try {
      const sentAt = new Date().toISOString();
      await kv.put(
        guardKey,
        JSON.stringify({ status: 'sent', sentAt, sent, failed, failedEmails, title }),
        { metadata: { status: 'sent', sentAt, sent, failed } },
      );
    } catch { /* guard write is best-effort */ }
  }

  return json({ ok: true, sent, failed, total: subs.length });
}
