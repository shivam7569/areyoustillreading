/**
 * src/lib/render-post-browser.mjs — BROWSER build of the render-at-publish engine.
 *
 * Renders a post's Markdown body to HTML in the browser using the SAME shared
 * markdown pipeline as the static build (src/lib/markdown-config.mjs) — Shiki (JS
 * regex engine), KaTeX — plus the WASM D2 backend (src/lib/rehype-d2-browser.mjs).
 * Output is byte-identical to the build, so a post published instantly looks exactly
 * like one rendered by a full site build. This is what lets /api/publish write a
 * finished body to KV and serve it in seconds without a rebuild.
 *
 * Two browser-compat details make @astrojs/markdown-remark run client-side:
 *   1. Shiki's JS regex engine (in the shared config) instead of Oniguruma WASM —
 *      the WASM engine never loads in the browser and hangs the render.
 *   2. A Vite `define` (astro.config.mjs) replaces the process.env token markdown-
 *      remark reads at module load; the shim below covers any later process.* access.
 */
import { createMarkdownProcessor } from '@astrojs/markdown-remark';
import { markdownConfig } from './markdown-config.mjs';
import rehypeD2Browser from './rehype-d2-browser.mjs';

// Minimal Node `process` shim for the browser. The import-time
// process.env.ASTRO_PERFORMANCE_BENCHMARK read in markdown-remark is neutralized by a
// Vite define; this covers any runtime process.* access during rendering.
if (typeof globalThis.process === 'undefined') {
  globalThis.process = {
    env: { NODE_ENV: 'production' },
    platform: 'browser',
    cwd: () => '/',
    argv: [],
    version: '',
    versions: {},
    nextTick: (fn, ...args) => Promise.resolve().then(() => fn(...args)),
  };
}

let processorPromise = null;

export async function renderPostBodyBrowser(markdown) {
  if (!processorPromise) {
    processorPromise = createMarkdownProcessor(markdownConfig(rehypeD2Browser));
  }
  const processor = await processorPromise;
  const { code } = await processor.render(markdown || '');
  return code;
}
