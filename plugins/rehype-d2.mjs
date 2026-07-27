/*
 * rehype-d2 — build-time D2 diagram rendering, no headless browser.
 *
 * WHAT / SINGLE RESPONSIBILITY
 * A local rehype (HTML-AST / hast) transformer plugin. Its one job: find D2
 * diagram code fences in post HTML and swap each one for the diagram rendered to
 * inline SVG. A D2 fence is a Markdown code block tagged `d2` (three-backtick
 * fence + `d2`). Shiki is configured to SKIP lang `d2` (astro.config.mjs →
 * markdown.syntaxHighlight.excludeLangs: ['d2']) precisely so these blocks are NOT
 * turned into highlighted <span> soup; they arrive here intact as a plain
 * <pre><code class="language-d2">…raw diagram source…</code></pre>, which this
 * plugin can read verbatim and replace. Rendering uses @terrastruct/d2's WASM
 * engine, entirely in Node at build time — no client-side diagram JS is shipped
 * and there is no runtime layout shift. This REPLACED the old
 * rehype-mermaid + Playwright/Chromium path (no ~150MB browser download; faster,
 * lighter, more reliable builds). Mermaid is gone from the site entirely.
 *
 * WHERE IT SITS IN THE ARCHITECTURE
 * Pure build-time step of the static Astro build (the site deploys as static HTML
 * on Cloudflare Pages; Pages Functions + Supabase + Dodo handle the dynamic/paid
 * side, none of which touch this file). Registered in astro.config.mjs as the 2nd
 * entry of markdown.rehypePlugins: [rehypeKatex, rehypeD2]. Order matters only in
 * that KaTeX and D2 act on disjoint node types, so co-existing is safe; the real
 * ordering constraint is upstream — Shiki must be told to skip `d2` (see above) or
 * this plugin would never see raw fence text. Runs once per Markdown/MDX file
 * during `astro build`; produces zero output at request time.
 *
 * KEY IMPORTS / DEPENDENCIES
 *   - unist-util-visit      → walk the hast tree (find <pre>, and gather text).
 *   - hast-util-from-html-isomorphic → parse our generated SVG/error HTML string
 *                             back INTO a hast node so it can be spliced into the tree.
 *   - @terrastruct/d2 (D2)  → the WASM diagram compiler/renderer. Its Node build
 *                             runs on a worker_thread (see build-hygiene note below).
 *
 * WHAT DEPENDS ON THIS
 * Every published post whose body contains a d2 fence relies on this plugin to
 * become a picture. The admin editor (src/pages/admin/editor.astro) does NOT import
 * this file — it has its OWN client-side D2 path (lazy `import('@terrastruct/d2')`,
 * one reused instance) that calls compile/render with the SAME options (pad: 20,
 * noXMLTag: true) so the live editor preview matches the built site byte-for-byte.
 * If you change render options here, mirror them there (and vice-versa).
 *
 * BUILD-HYGIENE (non-obvious gotcha)
 * @terrastruct/d2's Node build runs on a worker_thread that keeps the event loop
 * alive. So: (1) we create a D2 instance ONLY for files that actually contain a d2
 * block — posts without diagrams spawn nothing; and (2) we terminate its worker in
 * a finally block when done, so `astro build` can exit cleanly instead of hanging.
 *
 * SECURITY / CORRECTNESS CAVEATS
 *   - The SVG returned by D2 is injected RAW (parsed straight into the tree, not
 *     escaped). This is trusted: the diagram source is authored/published content,
 *     and it never renders untrusted end-user input. `esc()` is used ONLY to make
 *     an error MESSAGE safe to show inside a <pre> when a diagram fails to compile.
 *   - A malformed diagram does not fail the build: the per-job try/catch renders a
 *     visible <pre class="d2-error"> in place of the diagram and keeps going.
 */
import { visit } from 'unist-util-visit';
import { fromHtmlIsomorphic } from 'hast-util-from-html-isomorphic';
import { D2 } from '@terrastruct/d2';

// Minimal HTML-escape for error text only (see SECURITY note in the header). Just
// the three chars that could break out of the surrounding <pre>; quotes not needed.
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// Concatenate all descendant text nodes of a <code> element → the raw diagram
// source. Uses visit() rather than reading children[0].value because the fence
// text can arrive split across multiple text nodes.
function codeText(node) {
  let out = '';
  visit(node, 'text', (t) => { out += t.value; });
  return out;
}

// True when a <code> element is a D2 fence. className in hast may be an array, a
// single string, or absent — normalize to an array before the membership test.
function isD2Code(code) {
  const cls = code.properties && code.properties.className;
  const classes = Array.isArray(cls) ? cls : cls ? [cls] : [];
  return classes.includes('language-d2');
}

export default function rehypeD2(options = {}) {
  // dagre layout (D2's default) avoids spawning the separate ELK layout worker.
  const renderOpts = { layout: 'dagre', pad: 20, noXMLTag: true, ...options };

  return async (tree) => {
    // PASS 1: collect. We do NOT render inside visit() because visit is synchronous
    // (it cannot await d2.compile/render) and because mutating the tree mid-walk is
    // fragile. Instead record each match's parent + index + raw source, then process
    // them after the walk. We keep {index, parent} (not the node itself) so we can
    // overwrite that exact child slot below.
    const jobs = [];
    visit(tree, 'element', (node, index, parent) => {
      // Only <pre> elements that have a real position in a parent are replaceable.
      if (node.tagName !== 'pre' || !parent || index === null || index === undefined) return;
      const code = node.children.find((c) => c.type === 'element' && c.tagName === 'code');
      if (!code || !isD2Code(code)) return;
      jobs.push({ index, parent, source: codeText(code) });
    });
    if (jobs.length === 0) return; // nothing to do → don't spawn D2 (keeps diagram-less builds cheap)

    // PASS 2: render. One D2 (worker_thread) instance shared across all jobs in
    // this file; compile/render are async so this runs sequentially.
    const d2 = new D2();
    try {
      for (const job of jobs) {
        let html;
        try {
          // compile → validate/layout the diagram; render → produce the SVG string.
          // renderOptions from compile carries layout metadata forward into render.
          const res = await d2.compile(job.source, renderOpts);
          const svg = await d2.render(res.diagram, res.renderOptions);
          html = `<figure class="d2-diagram">${svg}</figure>`;
        } catch (e) {
          // Per-diagram failure is contained: emit a visible error box, don't abort
          // the whole build. esc() keeps the message from breaking out of the <pre>.
          html = `<pre class="d2-error">D2 error: ${esc((e && e.message) || e)}</pre>`;
        }
        // Parse our generated HTML string back into a hast node and splice it in
        // over the original <pre> (fragment: true → no wrapping <html>/<body>).
        const root = fromHtmlIsomorphic(html, { fragment: true });
        job.parent.children[job.index] = root.children[0];
      }
    } finally {
      // Release the worker_thread so `astro build` can exit. Optional-chained and
      // try/caught because the worker handle is an internal detail that may be
      // absent or already gone; failing to terminate must not fail the build.
      try { await d2.worker?.terminate?.(); } catch {}
    }
  };
}
