/**
 * src/lib/markdown-config.mjs
 * ============================================================================
 * The SINGLE source of truth for the Markdown → HTML rendering pipeline, shared by:
 *   1. the Astro static build (astro.config.mjs),
 *   2. the Node render-at-publish path (src/lib/render-post.mjs), and
 *   3. the BROWSER render-at-publish path (src/lib/render-post-browser.mjs).
 *
 * WHY ONE CONFIG: a post published instantly (rendered in the browser) must look
 * identical to the same post rendered by the full build. Feeding the exact same
 * plugins + options to all three paths is what guarantees that.
 *
 * SHARED, EVERYWHERE:
 *   - Shiki syntax highlighting with ```d2 excluded (so D2 fences reach rehype-d2),
 *     dual github-light/github-dark themes, soft-wrap.
 *   - The Shiki **JavaScript regex engine** (not the Oniguruma WASM engine). This is
 *     deliberate and load-bearing: the WASM engine never loads in the browser and
 *     hangs the render, and using ONE engine in both build and browser keeps the
 *     highlighted HTML byte-identical. (createJavaScriptRegexEngine works in Node too.)
 *   - remark-math ($…$ / $$…$$) → rehype-katex (static KaTeX HTML).
 *
 * INJECTED PER ENVIRONMENT — the D2 rehype plugin:
 *   D2 is the one step with two backends: the Node worker_thread build at build time
 *   (plugins/rehype-d2.mjs) and the WASM build in the browser (src/lib/rehype-d2-
 *   browser.mjs). So markdownConfig() takes the environment's D2 plugin as an argument
 *   rather than importing one here — which also keeps THIS module free of Node-only
 *   imports, so it bundles cleanly for the browser.
 */
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { createJavaScriptRegexEngine } from 'shiki';
// Pure hast transform (no Node/WASM) → safe to import in every environment. Turns a
// published ```plotly figure fence into a reader plot + collapsible code view.
import rehypePlotly from './rehype-plotly.mjs';

// One shared engine instance (pure JS, no WASM). Created once at module load.
const engine = createJavaScriptRegexEngine();

export const shikiConfig = {
  themes: { light: 'github-light', dark: 'github-dark' },
  wrap: true,
  engine,
};

/**
 * Build the Astro `markdown` / createMarkdownProcessor config.
 * @param {import('unified').Plugin} [rehypeD2] - the environment's D2 rehype plugin
 *   (Node worker build for the static build, WASM build for the browser). Omit to
 *   skip D2 rendering entirely (D2 fences stay as plain code).
 */
export function markdownConfig(rehypeD2) {
  return {
    // `plotly` is excluded (like `d2`) so its figure-JSON fence reaches rehypePlotly
    // raw instead of being syntax-highlighted into span soup.
    syntaxHighlight: { type: 'shiki', excludeLangs: ['d2', 'plotly'] },
    remarkPlugins: [remarkMath],
    rehypePlugins: rehypeD2 ? [rehypeKatex, rehypeD2, rehypePlotly] : [rehypeKatex, rehypePlotly],
    shikiConfig,
  };
}
