/*
 * /api/author/post — save (create/update) or delete an AUTHOR's own DB draft.
 * ============================================================================
 * The DB-authoring counterpart of /api/publish (which commits a Markdown file). Every
 * request is gated by requireAuthor (active author or owner); the validated userId is
 * passed to public.author_save_post / author_unpublish as p_caller (service-role), where
 * ownership is re-checked. This writes only author-editable columns of content.posts —
 * body_html/status/published_* stay the province of /api/author/publish.
 *
 *   POST   { post_id?, slug, title, description, tags[], body_md, body_doc?, pub_date?,
 *            publish_at?, gateable?, preview?, author_byline? } -> { ok, post_id }
 *   DELETE ?id=<post_id>  (soft-delete via unpublish_post op='delete')          -> { ok }
 */
import { requireAuthor, svcRpc, rpcError, json } from '../../../lib/require-author.js';

export async function onRequestPost({ request, env }) {
  const gate = await requireAuthor(request, env);
  if (!gate.ok) return json({ error: gate.error }, gate.status);

  let p;
  try { p = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const { post_id, slug, title, description, tags, body_md, body_doc, pub_date, publish_at, gateable, preview, author_byline } = p || {};

  // slug is the @handle/slug path segment — same strict shape the file publisher uses.
  if (typeof slug !== 'string' || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug)) {
    return json({ error: 'Invalid slug (lowercase letters, digits, hyphens)' }, 400);
  }

  const r = await svcRpc(env, 'author_save_post', {
    p_caller: gate.userId,
    p_post_id: post_id || null,
    p_slug: slug,
    p_title: typeof title === 'string' ? title : '',
    p_description: typeof description === 'string' ? description : '',
    p_tags: Array.isArray(tags) ? tags.filter((t) => typeof t === 'string') : [],
    p_body_md: typeof body_md === 'string' ? body_md : '',
    p_body_doc: body_doc == null ? null : body_doc,
    p_pub_date: pub_date || null,
    p_publish_at: publish_at || null,
    p_gateable: !!gateable,
    p_preview: typeof preview === 'string' ? preview : '',
    p_author_byline: typeof author_byline === 'string' ? author_byline : '',
  });
  if (!r.ok) return rpcError(r);
  return json({ ok: true, post_id: r.data });
}

export async function onRequestDelete({ request, env }) {
  const gate = await requireAuthor(request, env);
  if (!gate.ok) return json({ error: gate.error }, gate.status);

  const id = new URL(request.url).searchParams.get('id');
  if (!id) return json({ error: 'Missing post id' }, 400);

  const r = await svcRpc(env, 'author_unpublish', { p_caller: gate.userId, p_post_id: id, p_op: 'delete' });
  if (!r.ok) return rpcError(r);
  return json({ ok: true });
}
