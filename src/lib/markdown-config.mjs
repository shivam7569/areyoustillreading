/**
 * src/lib/markdown-config.mjs
 * ============================================================================
 * The SINGLE source of truth for the Markdown → HTML rendering pipeline, shared
 * by BOTH:
 *   1. the Astro static build (astro.config.mjs imports this), and
 *   2. the render-at-publish path (src/lib/render-post.mjs), which renders a post
 *      to HTML on its own — in the browser at publish time — so it can be written
 *      to KV and served instantly, without a full site rebuild.
 *
 * WHY ONE CONFIG: a post published instantly (rendered via render-post.mjs) MUST
 * look identical to the same post rendered by the full build. The only way to
 * guarantee that is to feed the exact same plugin list + options to both paths.
 * Never fork these settings — change them here and both paths stay in lockstep.
 *
 * Pipeline (unchanged from the original inline astro.config.mjs markdown block):
 *   - syntaxHighlight: Shiki, with ```d2 excluded so rehype-d2 sees raw fences.
 *   - remark: remark-math ($…$ / $$…$$ → math nodes).
 *   - rehype: rehype-katex (math → static KaTeX HTML), then rehype-d2 (```d2 →
 *     inline SVG via @terrastruct/d2 WASM at render time, no Chromium).
 *   - shikiConfig: dual github-light/github-dark themes, soft-wrap long lines.
 *
 * NOTE ON D2 BACKEND: plugins/rehype-d2.mjs uses the Node (worker_thread) D2 build,
 * which is correct for the build and for a Node render. The browser publish path
 * swaps in the browser/WASM D2 build (handled in render-post.mjs / the editor);
 * the plugin list here is otherwise identical across environments.
 */
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeD2 from '../../plugins/rehype-d2.mjs';

export const markdownConfig = {
  syntaxHighlight: { type: 'shiki', excludeLangs: ['d2'] },
  remarkPlugins: [remarkMath],
  rehypePlugins: [rehypeKatex, rehypeD2],
  shikiConfig: {
    themes: { light: 'github-light', dark: 'github-dark' },
    wrap: true,
  },
};
