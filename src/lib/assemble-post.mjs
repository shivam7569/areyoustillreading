/**
 * src/lib/assemble-post.mjs — assemble a full blog-post page from the shell donor.
 *
 * Browser-usable. Given the fetched /post-shell HTML (full BlogPost chrome around
 * sentinel tokens, with the CURRENT deployment's asset URLs) plus a post's data and
 * its rendered body HTML, returns the complete page HTML to store in KV. It works by
 * targeted string replacement of the sentinels the shell renders (see
 * src/pages/post-shell.astro) — no DOM parsing / selectors, so it doesn't couple to
 * the exact head/markup structure and can't silently drift.
 *
 * Parity note: the byline date is formatted in UTC to match BlogPost's
 * toLocaleDateString('en-US', …) as produced on Cloudflare's UTC build machines, and
 * reading time uses the same words/200 formula on the same (title-stripped) body — so
 * the instant KV page and the later rebuilt static page agree.
 */
const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
function fmtDateUTC(d) {
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/**
 * @param {string} shellHtml               fetched /post-shell page HTML
 * @param {object} post
 * @param {string} post.slug
 * @param {string} post.title
 * @param {string} post.description
 * @param {string} post.pubDate            YYYY-MM-DD
 * @param {string[]} [post.tags]
 * @param {string} [post.bodyMarkdown]     title-stripped body markdown (for reading time)
 * @param {string} [post.bodyHtml]         rendered body HTML
 * @returns {string} full page HTML
 */
export function assemblePostHtml(shellHtml, { slug, title, description, pubDate, tags = [], bodyMarkdown = '', bodyHtml = '' }) {
  const d = new Date(`${pubDate}T00:00:00.000Z`);
  const iso = d.toISOString();
  const human = fmtDateUTC(d);
  const words = bodyMarkdown.split(/\s+/).filter(Boolean).length;
  const minutes = Math.max(1, Math.round(words / 200));
  const tagsHtml = tags.length
    ? `<p class="tags">${tags.map((t) => `<a class="tag" href="/blog/tags/${esc(t)}">#${esc(t)}</a>`).join('')}</p>`
    : '';

  return shellHtml
    // Multi-occurrence sentinels (title in <title>/<h1>/og/twitter; desc in meta/og;
    // id in og:image path + island postIds; the shell's own /post-shell/ URL in
    // canonical + og:url). split/join replaces every occurrence.
    .split('AYSRZZTITLE').join(esc(title))
    .split('AYSRZZDESC').join(esc(description))
    .split('AYSRZZID').join(slug)
    .split('/post-shell/').join(`/blog/${slug}/`)
    // Single-occurrence byline bits.
    .replace('1970-01-01T00:00:00.000Z', iso)
    .replace('January 1, 1970', human)
    .replace('1 min read', `${minutes} min read`)
    // Insert the tag row (if any) before the body, and fill the body marker. Regex
    // tolerates however Astro renders the empty marker div's attributes.
    .replace(/<div data-shell-body[^>]*><\/div>/, `${tagsHtml}<div data-shell-body>${bodyHtml}</div>`);
}
