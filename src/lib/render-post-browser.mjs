/**
 * src/lib/render-post-browser.mjs — BROWSER build of the render-at-publish engine.
 *
 * Same createMarkdownProcessor pipeline as the Node render-post.mjs / the build,
 * but assembled for the browser: Shiki and KaTeX run client-side fine. D2 is the
 * one plugin that can't use its Node (worker_thread) backend here — it's handled
 * separately with the editor's WASM D2 (added once this core is proven to bundle
 * and run in the browser). This module is currently a FEASIBILITY SPIKE for that.
 */
import { createMarkdownProcessor } from '@astrojs/markdown-remark';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
// Shiki's DEFAULT engine loads the Oniguruma WASM binary at runtime, which never
// resolves in the browser (the render hangs forever). The pure-JS regex engine
// avoids WASM entirely and runs client-side. See research finding on shiki#510.
import { createJavaScriptRegexEngine } from 'shiki';

// @astrojs/markdown-remark references the Node `process` global at runtime (e.g.
// process.env / NODE_ENV checks). In the browser that's a ReferenceError, so
// provide a minimal shim once at module load, before any render runs.
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
    processorPromise = createMarkdownProcessor({
      // D2 excluded from Shiki (as in the build); D2 fences pass through untouched
      // for now (browser D2 backend wired in a follow-up).
      syntaxHighlight: { type: 'shiki', excludeLangs: ['d2'] },
      remarkPlugins: [remarkMath],
      rehypePlugins: [rehypeKatex],
      shikiConfig: {
        themes: { light: 'github-light', dark: 'github-dark' },
        wrap: true,
        engine: createJavaScriptRegexEngine(),
      },
    });
  }
  const processor = await processorPromise;
  const { code } = await processor.render(markdown || '');
  return code;
}
