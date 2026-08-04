/**
 * /api/notify — the author's notification hub. One email per new reader interaction.
 * =============================================================================
 * Reader interactions are written browser → Supabase directly (no server in the
 * path), so the reliable, server-authoritative way to notify the author of EVERY
 * one is a Postgres AFTER INSERT trigger (pg_net) on each table, all POSTing here
 * — see db/notify.sql. This endpoint receives the webhook-style payload
 * { type, table, record, ... }, verifies a shared secret, and emails the author a
 * summary via Resend.
 *
 * COVERS (one webhook per table → this endpoint — see db/notify.sql):
 *   comments            → a new comment (or, when parent_id is set, a reply/discussion)
 *   highlight_comments  → a reply in a highlight's private discussion
 *   highlights          → a reader highlighted a passage
 *   notes               → a reader saved a private note
 *   feedback            → a reader answered "Did it hold?" (first answer only — the
 *                         poll upserts, and AFTER INSERT fires once per reader/post)
 *
 * The author's own admin actions are skipped (author_is_admin). Fully best-effort:
 * a missing secret/email/key or any send error returns 200 so a webhook never
 * retries in a way that hurts the reader; nothing here blocks an interaction.
 *
 * ENV: NOTIFY_SECRET (shared with the webhook header), AUTHOR_EMAIL (where notices go),
 *      RESEND_API_KEY, EMAIL_FROM, SITE_URL.
 */

const OK = () => new Response(null, { status: 200 });
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clip = (s, n = 320) => { const t = String(s || '').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

const CHOICE_LABEL = { held: 'Held me', skimmed: 'Skimmed it', lost: 'Lost me' };

// Service-role single-row GET (best-effort). Used to resolve a vote's target — the
// votes table has no post_id/author, so we look up the comment/reply it points at.
async function sbGet(env, path) {
  const sb = env.SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sb || !key) return null;
  try {
    const r = await fetch(`${sb}/rest/v1/${path}`, { headers: { Authorization: `Bearer ${key}`, apikey: key }, signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    const j = await r.json();
    return Array.isArray(j) ? (j[0] || null) : j;
  } catch { return null; }
}

// Build { subject, lead, body, slug? } for a webhook record, or null to skip. Async
// because a vote must resolve its target row to know which post/author it concerns.
async function describe(table, rec, env) {
  const who = esc(rec.author_name || 'A reader');
  const slug = rec.post_id || '';
  switch (table) {
    case 'comments':
      return {
        subject: `${rec.author_name || 'A reader'} ${rec.parent_id ? 'replied to a comment' : 'commented'} on ${slug}`,
        lead: `${who} ${rec.parent_id ? 'replied in the discussion' : 'left a comment'}`,
        body: clip(rec.body),
      };
    case 'highlight_comments':
      return { subject: `${rec.author_name || 'A reader'} replied in a highlight discussion on ${slug}`, lead: `${who} replied in a highlight discussion`, body: clip(rec.body) };
    case 'highlights':
      return { subject: `${rec.author_name || 'A reader'} highlighted a passage in ${slug}`, lead: `${who} highlighted a passage`, body: rec.quote ? `“${clip(rec.quote, 240)}”` : '' };
    case 'notes':
      return { subject: `${rec.author_name || 'A reader'} saved a private note on ${slug}`, lead: `${who} saved a private note`, body: clip(rec.body) };
    case 'feedback': {
      const label = CHOICE_LABEL[rec.choice] || rec.choice;
      const where = rec.choice === 'lost' && rec.lost_para ? ` — attention broke around ¶${rec.lost_para}` : '';
      return { subject: `A reader’s verdict on ${slug}: ${label}`, lead: `A reader answered “Did it hold?”`, body: `${label}${where}` };
    }
    case 'votes': {
      // An upvote on a comment (kind='comment') or a highlight-discussion reply
      // ('hlcomment'). Resolve the target to find the post + the comment's author,
      // and skip a reader upvoting their OWN comment (not worth an email).
      const tid = rec.target_id;
      if (rec.kind === 'comment') {
        const c = await sbGet(env, `comments?id=eq.${tid}&select=post_id,user_id,author_name,body`);
        if (!c || (c.user_id && c.user_id === rec.user_id)) return null;
        return { subject: `${c.author_name || 'A reader'}’s comment on ${c.post_id} was upvoted`, lead: `Someone upvoted ${esc(c.author_name || 'a reader')}’s comment`, body: c.body ? clip(c.body, 200) : '', slug: c.post_id || '' };
      }
      if (rec.kind === 'hlcomment') {
        const hc = await sbGet(env, `highlight_comments?id=eq.${tid}&select=user_id,author_name,body,highlight_id`);
        if (!hc || (hc.user_id && hc.user_id === rec.user_id)) return null;
        const h = hc.highlight_id ? await sbGet(env, `highlights?id=eq.${hc.highlight_id}&select=post_id`) : null;
        const s = h ? (h.post_id || '') : '';
        return { subject: `A highlight-discussion reply${s ? ' on ' + s : ''} was upvoted`, lead: `Someone upvoted ${esc(hc.author_name || 'a reader')}’s reply in a highlight discussion`, body: hc.body ? clip(hc.body, 200) : '', slug: s };
      }
      return null;
    }
    default:
      return null;
  }
}

function renderEmail({ lead, body, postUrl, engageUrl, slug }) {
  const safeBody = body ? `<div style="margin:14px 0 18px;padding:14px 16px;border-left:3px solid #d6a75f;background:#faf7f1;border-radius:4px;color:#443c30;font-size:15px;line-height:1.55;white-space:pre-wrap">${esc(body)}</div>` : '';
  const html = `<!doctype html><html><body style="margin:0;background:#f3eee3;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1c1813">
  <div style="max-width:520px;margin:0 auto;padding:28px 22px">
    <div style="background:#fffdf8;border:1px solid #d8cfbd;border-radius:8px;padding:26px 24px">
      <div style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#5e3560;font-weight:600;margin-bottom:12px">areyoustillreading · reader activity</div>
      <div style="font-family:Georgia,serif;font-size:20px;font-weight:600;color:#1c1813;line-height:1.3">${esc(lead)}</div>
      <div style="font-size:13px;color:#726752;margin-top:5px">on <a href="${esc(postUrl)}" style="color:#5e3560;text-decoration:none">${esc(slug)}</a></div>
      ${safeBody}
      <div style="margin-top:20px">
        <a href="${esc(engageUrl)}" style="display:inline-block;background:#5e3560;color:#faf3fa;text-decoration:none;font-size:14px;font-weight:600;padding:10px 18px;border-radius:3px">Open the Studio →</a>
        <a href="${esc(postUrl)}" style="display:inline-block;margin-left:8px;color:#5e3560;text-decoration:none;font-size:14px;padding:10px 6px">Read the post</a>
      </div>
    </div>
    <div style="text-align:center;font-size:11.5px;color:#94886f;margin-top:16px">You’re the author — this is a private notification, not published anywhere.</div>
  </div></body></html>`;
  const text = `${lead}\non ${slug}\n\n${body ? body + '\n\n' : ''}Studio: ${engageUrl}\nPost: ${postUrl}`;
  return { html, text };
}

export async function onRequestPost({ request, env }) {
  // Shared-secret gate (the webhook sends it as a custom header). If NOTIFY_SECRET is
  // unset we still require a matching (empty) header mismatch to fail closed only when
  // configured — but treat an absent secret config as "not set up" → no-op.
  const secret = env.NOTIFY_SECRET;
  if (!secret) return OK();
  if (request.headers.get('x-notify-secret') !== secret) return new Response('forbidden', { status: 401 });

  let payload;
  try { payload = await request.json(); } catch { return OK(); }
  // Supabase webhook shape: { type:'INSERT', table, schema, record, old_record }.
  if (!payload || payload.type !== 'INSERT') return OK();
  const table = payload.table;
  const rec = payload.record;
  if (!table || !rec) return OK();

  // Never notify the author about their own admin comments/replies.
  if ((table === 'comments' || table === 'highlight_comments') && rec.author_is_admin) return OK();

  const to = env.AUTHOR_EMAIL;
  const apiKey = env.RESEND_API_KEY;
  if (!to || !apiKey) return OK(); // not configured yet → silently no-op

  const info = await describe(table, rec, env);
  if (!info) return OK();

  const site = env.SITE_URL || 'https://areyoustillreading.dev';
  const slug = info.slug != null ? info.slug : (rec.post_id || '');
  const postUrl = slug ? `${site}/blog/${encodeURIComponent(slug)}/` : site;
  const engageUrl = `${site}/admin/engagement`;
  const { html, text } = renderEmail({ lead: info.lead, body: info.body, postUrl, engageUrl, slug });
  const from = env.EMAIL_FROM || 'areyoustillreading <hello@areyoustillreading.dev>';

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject: info.subject, html, text }),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    /* best-effort — a failed notification must never surface or retry-storm */
  }
  return OK();
}
