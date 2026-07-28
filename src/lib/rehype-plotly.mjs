/**
 * src/lib/rehype-plotly.mjs — turn a published plotly figure fence into a reader
 * plot + a collapsible code view.
 * ============================================================================
 * WHAT / SINGLE RESPONSIBILITY
 *   A pure hast (HTML-AST) transform. The editor's publish step emits, after a
 *   ```python plot cell, a ```plotly fence carrying the computed figure JSON
 *   (Pyodide never runs on reader pages — far too heavy). Shiki is told to SKIP
 *   `plotly` (see markdown-config), so that fence arrives here intact as
 *   <pre><code class="language-plotly">…json…</code></pre>. This plugin replaces it
 *   with:
 *     <figure class="py-plot">
 *       <details class="py-code"><summary>Show code</summary> …the python <pre>… </details>
 *       <div class="plotly-figure"><script type="application/json" class="plotly-json">…</script></div>
 *     </figure>
 *   The immediately-preceding highlighted code block (the python source) is folded
 *   into the <details> so readers see the plot with the code one click away. A
 *   lightweight client (src/components/PlotlyReader.astro) hydrates each figure
 *   with plotly.js on scroll.
 *
 * WHERE IT SITS
 *   Added ONCE to the shared markdown pipeline (src/lib/markdown-config.mjs), so it
 *   runs in BOTH the static build and the instant-publish browser render — the two
 *   stay byte-identical. Pure tree manipulation (unist-util-visit only), no Node or
 *   WASM deps, so it bundles cleanly for the browser too.
 *
 * SECURITY: the figure JSON is author-authored (the signed-in admin's own cell
 * output), embedded in an INERT <script type="application/json"> (not executed).
 * Every `<` is written as < so the JSON can never break out of the script tag.
 */
import { visit } from 'unist-util-visit';

// Raw text of a <pre> IFF it is a ```plotly fence (Shiki-excluded → language-plotly),
// else null.
function plotlyJsonOf(pre) {
  if (!pre || pre.type !== 'element' || pre.tagName !== 'pre') return null;
  const code = (pre.children || []).find((c) => c.type === 'element' && c.tagName === 'code');
  if (!code) return null;
  const cls = code.properties && code.properties.className;
  const classes = Array.isArray(cls) ? cls : cls ? [cls] : [];
  if (!classes.includes('language-plotly')) return null;
  let text = '';
  visit(code, 'text', (t) => { text += t.value; });
  return text;
}

// Index of the previous ELEMENT sibling (skipping whitespace-only text). Returns
// -1 if the immediately-preceding non-whitespace node isn't an element.
function prevElementIndex(children, idx) {
  for (let i = idx - 1; i >= 0; i--) {
    const n = children[i];
    if (n.type === 'element') return i;
    if (n.type === 'text' && n.value.trim() === '') continue;
    return -1;
  }
  return -1;
}

export default function rehypePlotly() {
  return (tree) => {
    const jobs = [];
    visit(tree, 'element', (node, index, parent) => {
      if (node.tagName !== 'pre' || !parent || index === null || index === undefined) return;
      const json = plotlyJsonOf(node);
      if (json === null) return;
      jobs.push({ index, parent, json });
    });
    // Process highest-index first so splices don't invalidate earlier jobs' indices.
    for (let j = jobs.length - 1; j >= 0; j--) {
      const { index, parent, json } = jobs[j];
      let valid = false;
      try { JSON.parse(json); valid = true; } catch { /* leave the figure empty */ }

      // Inert JSON data island. Escape every '<' as < (valid JSON) so the
      // content can never terminate the <script> early.
      const dataScript = {
        type: 'element',
        tagName: 'script',
        properties: { type: 'application/json', className: ['plotly-json'] },
        children: [{ type: 'text', value: json.replace(/</g, '\\u003c') }],
      };
      const plotDiv = {
        type: 'element',
        tagName: 'div',
        properties: { className: ['plotly-figure'] },
        children: valid ? [dataScript] : [],
      };

      // Fold the immediately-preceding code block (the python source) into a
      // collapsible <details>. Never pair with another plotly fence.
      let codeIdx = prevElementIndex(parent.children, index);
      if (codeIdx >= 0) {
        const prev = parent.children[codeIdx];
        if (!(prev.type === 'element' && prev.tagName === 'pre' && plotlyJsonOf(prev) === null)) codeIdx = -1;
      }

      const figureChildren = [];
      if (codeIdx >= 0) {
        figureChildren.push({
          type: 'element',
          tagName: 'details',
          properties: { className: ['py-code'] },
          children: [
            { type: 'element', tagName: 'summary', properties: {}, children: [{ type: 'text', value: 'Show code' }] },
            parent.children[codeIdx],
          ],
        });
      }
      figureChildren.push(plotDiv);
      const figure = { type: 'element', tagName: 'figure', properties: { className: ['py-plot'] }, children: figureChildren };

      if (codeIdx >= 0) {
        parent.children.splice(index, 1); // remove the plotly <pre>
        parent.children.splice(codeIdx, 1); // remove the code <pre>
        parent.children.splice(codeIdx, 0, figure); // insert the combined figure
      } else {
        parent.children.splice(index, 1, figure);
      }
    }
  };
}
