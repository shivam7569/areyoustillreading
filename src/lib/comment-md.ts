/**
 * comment-md.ts — the shared tiny-Markdown + KaTeX renderer for reader comments.
 * =============================================================================
 * Used by BOTH the public Comments island (src/components/Comments.astro) and the
 * Studio Engagement moderation list (src/pages/admin/engagement.astro) so a comment
 * reads the same in both places — including math.
 *
 * SAFE by construction: escape first, then re-introduce only a whitelist of inline
 * markup (bold/italic/inline-code, http(s)/relative links) plus math delimiters that
 * are stashed before escaping and restored after, then handed to KaTeX. No raw HTML
 * from the user ever runs (KaTeX itself is called with throwOnError:false, trust off).
 */

const esc = (s: unknown): string =>
  String(s).replace(/[&<>]/g, (c) => (({ '&': '&amp;', '<': '&lt;', '>': '&gt;' } as Record<string, string>)[c]));

/** Render one comment body to safe HTML (math left as $…$/$$…$$ for renderMathIn). */
export function commentMd(s: string): string {
  let e = esc(s);
  const math: string[] = [];
  const stash = (m: string) => { math.push(m); return '@@KMATH' + (math.length - 1) + 'X@@'; };
  e = e.replace(/\$\$([\s\S]+?)\$\$/g, (m) => stash(m));
  e = e.replace(/\$([^$\n]+?)\$/g, (m) => stash(m));
  e = e.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\)/g, (_m, t, u) => '<a href="' + u.replace(/"/g, '%22') + '" rel="nofollow noopener" target="_blank">' + t + '</a>');
  e = e.replace(/`([^`]+)`/g, '<code class="inl">$1</code>');
  e = e.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  e = e.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  e = e.replace(/(^|[^\w])_([^_\n]+)_/g, '$1<em>$2</em>');
  e = e.replace(/\n/g, '<br>');
  e = e.replace(/@@KMATH([0-9]+)X@@/g, (_m, i) => math[+i]);
  return e;
}

let renderMathInElement: any = null;

/** Typeset $…$ / $$…$$ inside the given nodes with KaTeX (lazy-loaded). Best-effort. */
export async function renderMathIn(nodes: ArrayLike<Element> | null | undefined): Promise<void> {
  if (!nodes || !nodes.length) return;
  try {
    if (!renderMathInElement) { const mod: any = await import('katex/contrib/auto-render'); renderMathInElement = mod.default || mod; }
    Array.prototype.forEach.call(nodes, (n: Element) =>
      renderMathInElement(n, { delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }], throwOnError: false })
    );
  } catch (e) { /* math is progressive enhancement — never break the list */ }
}
