/**
 * src/lib/rehype-d2-browser.mjs — BROWSER twin of plugins/rehype-d2.mjs.
 *
 * Identical hast transform (find ```d2 fences → replace with the rendered <figure>
 * SVG), but uses @terrastruct/d2's BROWSER (WASM) build instead of the Node
 * worker_thread build, so the render-at-publish pipeline can produce diagrams in the
 * editor's browser. Same compile/render options and same <figure class="d2-diagram">
 * wrapper as the build plugin, so diagrams come out byte-identical.
 *
 * The browser D2 build has no worker_thread, so there is nothing to terminate; we
 * lazily create ONE D2 instance and reuse it across renders (matching the editor's
 * own loadD2()).
 */
import { visit } from 'unist-util-visit';
import { fromHtmlIsomorphic } from 'hast-util-from-html-isomorphic';

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function codeText(node) {
  let out = '';
  visit(node, 'text', (t) => { out += t.value; });
  return out;
}

function isD2Code(code) {
  const cls = code.properties && code.properties.className;
  const classes = Array.isArray(cls) ? cls : cls ? [cls] : [];
  return classes.includes('language-d2');
}

// Lazy, memoized browser D2 (WASM). One instance reused across renders.
let d2Promise = null;
function loadD2() {
  if (!d2Promise) d2Promise = import('@terrastruct/d2').then(({ D2 }) => new D2());
  return d2Promise;
}

export default function rehypeD2Browser(options = {}) {
  // Match plugins/rehype-d2.mjs exactly (dagre is D2's default; stated for parity).
  // themeID/darkThemeID: the SVG carries a prefers-color-scheme block so instant-
  // published diagrams adapt to dark mode too (not a white box until the rebuild).
  const renderOpts = { layout: 'dagre', pad: 20, noXMLTag: true, themeID: 0, darkThemeID: 200, ...options };

  return async (tree) => {
    const jobs = [];
    visit(tree, 'element', (node, index, parent) => {
      if (node.tagName !== 'pre' || !parent || index === null || index === undefined) return;
      const code = node.children.find((c) => c.type === 'element' && c.tagName === 'code');
      if (!code || !isD2Code(code)) return;
      jobs.push({ index, parent, source: codeText(code) });
    });
    if (jobs.length === 0) return;

    const d2 = await loadD2();
    for (const job of jobs) {
      let html;
      try {
        const res = await d2.compile(job.source, renderOpts);
        const svg = await d2.render(res.diagram, res.renderOptions);
        html = `<figure class="d2-diagram">${svg}</figure>`;
      } catch (e) {
        html = `<pre class="d2-error">D2 error: ${esc((e && e.message) || e)}</pre>`;
      }
      const root = fromHtmlIsomorphic(html, { fragment: true });
      job.parent.children[job.index] = root.children[0];
    }
  };
}
