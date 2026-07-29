/**
 * src/lib/rehype-code-chrome.mjs — editorial "chrome" around fenced code blocks.
 *
 * Wraps each highlighted code block in
 *   <div class="codeblock"><div class="code-top">·dots· LANG</div><pre>…</pre></div>
 * so a code block reads as an intentional, framed panel (with a header strip and a
 * language tag) instead of a bare dark rectangle — the piece that made published
 * code look off-theme in dark mode. Styling lives in global.css (.codeblock/.code-top).
 *
 * Pure hast transform (no Node/WASM), so it is safe in all three render paths
 * (static build, Node publish, browser publish) exactly like rehype-plotly.
 *
 * ORDER-ROBUST: works whether it runs before Shiki (block is a raw
 * `<pre><code class="language-ts">`) or after it (`<pre class="astro-code"
 * data-language="ts">`). It reads the language from `data-language` or the code's
 * `language-*` class, and either way just wraps the same <pre> — Shiki still finds
 * the inner `pre > code` and highlights it. `d2`/`plotly` fences are skipped (they
 * become figures via their own plugins, not code cards).
 */
import { visit } from 'unist-util-visit';

const SKIP = new Set(['d2', 'plotly', 'plotly-json']);

function classList(node) {
  const c = node && node.properties && node.properties.className;
  return Array.isArray(c) ? c : c ? [c] : [];
}

export default function rehypeCodeChrome() {
  return (tree) => {
    visit(tree, 'element', (node, index, parent) => {
      if (!parent || index === null || index === undefined) return;
      if (node.tagName !== 'pre') return;
      // Never wrap our own container's pre, or the injected python-output block.
      if (classList(parent).includes('codeblock')) return;
      const cls = classList(node);
      if (cls.includes('py-output')) return;

      const code = node.children.find((c) => c.type === 'element' && c.tagName === 'code');
      if (!code) return;

      // Language: pre[data-language] (post-Shiki) OR the code's language-* class (raw).
      let lang = (node.properties && node.properties.dataLanguage) || '';
      if (!lang) {
        const lc = classList(code).find((x) => typeof x === 'string' && x.startsWith('language-'));
        if (lc) lang = lc.slice('language-'.length);
      }
      lang = String(lang || '').toLowerCase();
      if (SKIP.has(lang)) return; // figures, not code cards

      const dots = {
        type: 'element', tagName: 'span',
        properties: { className: ['code-dots'], 'aria-hidden': 'true' },
        children: [0, 1, 2].map(() => ({ type: 'element', tagName: 'span', properties: { className: ['dot'] }, children: [] })),
      };
      const label = {
        type: 'element', tagName: 'span',
        properties: { className: ['code-lang'] },
        children: [{ type: 'text', value: lang || 'code' }],
      };
      const top = {
        type: 'element', tagName: 'div',
        properties: { className: ['code-top'] },
        children: [dots, label],
      };
      const wrapper = {
        type: 'element', tagName: 'div',
        properties: { className: ['codeblock'] },
        children: [top, node],
      };
      // 1:1 replacement (indices don't shift); the guard above prevents re-wrapping
      // the inner <pre> when visit descends into the new wrapper.
      parent.children[index] = wrapper;
    });
  };
}
