/*
 * rehype-d2 — build-time D2 diagram rendering, no headless browser.
 *
 * Finds ```d2 fenced code blocks (Shiki is configured to skip lang `d2`, so they
 * arrive as <pre><code class="language-d2">…</code></pre>) and replaces each with
 * the diagram rendered to inline SVG by @terrastruct/d2's WASM engine — entirely in
 * Node at build time. Replaces the old rehype-mermaid + Playwright/Chromium path
 * (no ~150MB browser download; faster, lighter, more reliable builds).
 *
 * Build-hygiene: @terrastruct/d2's Node build runs on a worker_thread. We create a
 * D2 instance ONLY for files that actually contain a d2 block, and terminate its
 * worker when done, so posts without diagrams spawn nothing and the build process
 * always exits cleanly.
 */
import { visit } from 'unist-util-visit';
import { fromHtmlIsomorphic } from 'hast-util-from-html-isomorphic';
import { D2 } from '@terrastruct/d2';

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

export default function rehypeD2(options = {}) {
  // dagre layout (D2's default) avoids spawning the separate ELK layout worker.
  const renderOpts = { layout: 'dagre', pad: 20, noXMLTag: true, ...options };

  return async (tree) => {
    const jobs = [];
    visit(tree, 'element', (node, index, parent) => {
      if (node.tagName !== 'pre' || !parent || index === null || index === undefined) return;
      const code = node.children.find((c) => c.type === 'element' && c.tagName === 'code');
      if (!code || !isD2Code(code)) return;
      jobs.push({ index, parent, source: codeText(code) });
    });
    if (jobs.length === 0) return; // nothing to do → don't spawn D2

    const d2 = new D2();
    try {
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
    } finally {
      // Release the worker_thread so `astro build` can exit.
      try { await d2.worker?.terminate?.(); } catch {}
    }
  };
}
