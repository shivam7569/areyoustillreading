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
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import { defaultSchema } from 'hast-util-sanitize';
import { createJavaScriptRegexEngine } from 'shiki';
// Pure hast transform (no Node/WASM) → safe to import in every environment. Turns a
// published ```plotly figure fence into a reader plot + collapsible code view.
import rehypePlotly from './rehype-plotly.mjs';
// Pure hast transform → wraps highlighted code blocks in editorial chrome
// (header strip with muted dots + a language tag) so code reads as a framed panel.
import rehypeCodeChrome from './rehype-code-chrome.mjs';

// One shared engine instance (pure JS, no WASM). Created once at module load.
const engine = createJavaScriptRegexEngine();

// ── UGC sanitize ────────────────────────────────────────────────────────────
// Runs FIRST in the rehype chain (see markdownConfig): the tree at that point holds the
// AUTHOR's markdown-rendered HTML plus Shiki's already-highlighted code — nothing else.
// So it strips the author's dangerous raw HTML (script/onX/iframe/javascript:) via the
// safe default schema, while we only need to re-permit Shiki's inline-styled spans + the
// fence/math classes our later plugins (KaTeX/D2/Plotly/code-chrome) read. Those plugins
// run AFTER this, so their SVG/JSON/spans are trusted and never sanitized.
const A = defaultSchema.attributes || {};
export const sanitizeSchema = {
  ...defaultSchema,
  // The editorial raw-HTML elements authors legitimately use (blockquote/cite already in the
  // default set); everything not listed is unwrapped to its text, and script/style/on*/etc.
  // are dropped outright.
  tagNames: [...(defaultSchema.tagNames || []), 'cite', 'aside', 'figure', 'figcaption', 'mark', 'abbr', 'details', 'summary'],
  attributes: {
    ...A,
    // Class names are harmless (they can't execute) and load-bearing for our render:
    // Shiki scopes its palette under `.astro-code`, and the math placeholder reaches KaTeX
    // via its class. Allow both hast (`className`) and the raw (`class`) forms, because
    // Astro's built-in Shiki emits a raw `class` string rather than a hast className array.
    '*': [...(A['*'] || []), 'className', 'class', 'ariaHidden'],
    // Inline `style` only where our pipeline needs it (Shiki's css-variables theme) — never
    // on prose elements, so an author can't inline-style arbitrary content.
    pre: [...(A.pre || []), 'style', 'tabIndex', 'tabindex', 'dataLanguage'],
    code: [...(A.code || []), 'style'],
    span: [...(A.span || []), 'style'],
  },
};

// Editorial code blocks are ALWAYS dark (like the design), framed on the warm
// --code-bg surface (global.css styles the <pre>). A single dark theme means the
// highlighted spans carry dark-theme colours in both light and dark page themes —
// no dual-theme swap needed. `css-variables` lets global.css tint the palette to
// the warm editorial tokens (--astro-code-token-*) instead of a cool default.
export const shikiConfig = {
  theme: 'css-variables',
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
    // rehypeRaw parses the author's raw HTML (which Astro leaves as raw string nodes) into real
    // hast elements so rehypeSanitize can allow-list the safe ones (blockquote/aside/figure…) and
    // drop the dangerous ones (script/onX/iframe/javascript:). Both run BEFORE the trusted
    // transforms (KaTeX/D2/Plotly/code-chrome), whose SVG/JSON/styled markup must not be
    // sanitized. Shiki (Astro's built-in) has already run; its output survives via sanitizeSchema.
    rehypePlugins: rehypeD2
      ? [rehypeRaw, [rehypeSanitize, sanitizeSchema], rehypeKatex, rehypeD2, rehypePlotly, rehypeCodeChrome]
      : [rehypeRaw, [rehypeSanitize, sanitizeSchema], rehypeKatex, rehypePlotly, rehypeCodeChrome],
    shikiConfig,
  };
}
