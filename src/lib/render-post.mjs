/**
 * src/lib/render-post.mjs
 * ============================================================================
 * Render a post's Markdown BODY to HTML using the exact same pipeline as the
 * Astro static build (src/lib/markdown-config.mjs). This is the render-at-publish
 * engine: it lets us produce a post's HTML on its own — in the browser at publish
 * time, or in Node — so the result can be written to KV and served instantly by
 * the /blog/<slug> overlay, with no full site rebuild.
 *
 * WHY IT MATCHES THE BUILD: Astro's own Markdown rendering is @astrojs/markdown-
 * remark under the hood, configured from `markdown:` in astro.config.mjs — which is
 * now the shared `markdownConfig`. Feeding that same config to createMarkdownProcessor
 * here yields the same HTML for the same Markdown, so an instantly-published post is
 * visually identical to one rendered by the build.
 *
 * SCOPE: this renders the BODY only (the compiled Markdown), not the page shell
 * (layout/nav/head). The overlay assembles the full page by injecting this body
 * into the live shell template. See functions/blog/_middleware.js and the shell.
 *
 * D2 NOTE: plugins/rehype-d2.mjs uses the Node (worker_thread) D2 build. In Node
 * this works as-is. In the browser publish path, the D2 backend is swapped for the
 * WASM build the editor already loads; everything else in the pipeline is identical.
 */
import { createMarkdownProcessor } from '@astrojs/markdown-remark';
import { markdownConfig } from './markdown-config.mjs';

// Building the processor is relatively expensive (loads Shiki grammars/themes), so
// memoize it — one processor per runtime, reused across renders.
let processorPromise = null;

/**
 * Render Markdown body text to an HTML string, identical to the build pipeline.
 * @param {string} markdown - the post body (frontmatter already stripped).
 * @returns {Promise<string>} rendered HTML.
 */
export async function renderPostBody(markdown) {
  if (!processorPromise) processorPromise = createMarkdownProcessor(markdownConfig);
  const processor = await processorPromise;
  const { code } = await processor.render(markdown || '');
  return code;
}
