// @ts-check
// `@ts-check` opts this config file into TypeScript's checker via JSDoc. It costs
// nothing at runtime (Astro loads the .mjs directly) but catches typos in the
// integration/markdown option shapes at edit time. Keep it — silent config typos
// are otherwise only discovered by a broken build.

/**
 * astro.config.mjs — the single source of truth for how Astro builds this site.
 *
 * SINGLE RESPONSIBILITY
 * ---------------------
 * Declares build-time behavior only: the canonical site origin, which Astro
 * integrations run, and the full Markdown/MDX processing pipeline (syntax
 * highlighting, math, diagrams). It configures how `.md`/`.mdx` content and pages
 * are compiled into the static HTML/CSS/JS bundle. It does NOT configure runtime,
 * hosting, secrets, or any backend — those live elsewhere (see below).
 *
 * WHERE IT SITS IN THE ARCHITECTURE
 * ---------------------------------
 * This is a STATIC Astro build. `npm run build` reads this file, runs `astro
 * build` and then `pagefind --site dist` (search indexing is a post-build CLI
 * step in package.json, not an Astro integration), producing a `dist/` folder of
 * pre-rendered HTML + assets. Two deploy paths push that `dist/`: (1) `npm run
 * deploy` = Wrangler direct upload for manual/CI deploys, and (2) the in-app
 * publish pipeline (functions/api/publish.js commits Markdown to GitHub, which
 * triggers a Cloudflare Pages Git-integration rebuild). Either way, everything
 * configured in THIS file runs ONCE at build time on the builder machine — never
 * in the browser and never in a Cloudflare Pages Function. The dynamic backend
 * (Supabase/PostgREST +
 * RLS, Resend email, Turnstile bot-check, Dodo Payments Merchant-of-Record
 * paywall, Supabase auth) is entirely separate: it lives in Pages Functions and
 * client-side Supabase JS, none of which this file touches. Do not add secrets or
 * server config here.
 *
 * IMPORTS / DEPENDENCIES (all dev/build-time only)
 * ------------------------------------------------
 *   - astro/config           → defineConfig() type helper.
 *   - remark-math            → parses `$…$` / `$$…$$` math in Markdown ASTs.
 *   - rehype-katex           → renders that parsed math to static KaTeX HTML.
 *   - ./plugins/rehype-d2    → renders ```d2 fences to inline SVG at build (no Chromium).
 *   - @astrojs/sitemap       → emits sitemap.xml / sitemap-index.xml.
 * NOTE: the project also uses Shiki, @astrojs/rss, Pagefind search, and
 * astro-og-canvas (OG images). Shiki is configured below (it is Astro's built-in
 * Markdown highlighter, no separate import needed). RSS/Pagefind/og-canvas are
 * wired up in their own files (endpoints/components), NOT here — so their absence
 * from this config is expected, not a bug.
 *
 * WHAT DEPENDS ON THIS FILE
 * -------------------------
 *   - The Astro build/dev CLI reads it implicitly on every `astro build`/`dev`.
 *   - Every Markdown/MDX post relies on the pipeline here for math, code
 *     highlighting, and D2 diagrams to render correctly. (D2 replaced the older
 *     Mermaid setup — if you find lingering "mermaid" references elsewhere, they
 *     are stale.)
 *   - Anything consuming absolute URLs at build time (sitemap, RSS, canonical
 *     link tags, OG image URLs) derives them from `site` below.
 *
 * SECURITY / CORRECTNESS NOTES & GOTCHAS
 * --------------------------------------
 *   - The sitemap `filter` (see below) is the one line here with a privacy/leak
 *     implication: it keeps paywalled `/gated/` URLs out of the public sitemap so
 *     search engines are not handed a directory of gated content. It is a
 *     defense-in-depth convenience for discoverability ONLY — it is NOT the
 *     access control. Actual paywall enforcement is entitlement/token checks in
 *     Pages Functions backed by Supabase RLS. Never treat sitemap omission as
 *     security; never rely on it to hide a URL from a determined visitor.
 *   - `site` must exactly match the production origin (protocol + host, no
 *     trailing path). A wrong value silently corrupts every absolute URL the
 *     build generates (sitemap, RSS, canonical, OG) — no error, just bad links.
 */
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import rehypeD2 from './plugins/rehype-d2.mjs';
// The Markdown pipeline (Shiki + KaTeX + D2) is defined ONCE in a shared module so
// the render-at-publish paths produce byte-identical HTML to this build. D2 is passed
// in per environment (Node worker build here); see that file for the full rationale.
import { markdownConfig } from './src/lib/markdown-config.mjs';

// https://astro.build/config
export default defineConfig({
  // Canonical production origin. Consumed at build time to turn every relative
  // route into an absolute URL (sitemap entries, RSS <link>s, canonical tags, OG
  // image URLs). Must be the exact deployed origin, protocol included, no path.
  site: 'https://areyoustillreading.dev',

  // Near-instant navigation: warm each internal link on hover (prefetchAll adds a
  // <link rel=prefetch> for every in-viewport/hovered <a>). Astro auto-downgrades to
  // 'tap' on Save-Data / slow connections, so this never hurts constrained clients.
  prefetch: { prefetchAll: true, defaultStrategy: 'hover' },
  // Chromium speculation-rules prerender of hovered links → the next page paints from
  // an already-rendered document (~0ms). Other engines fall back to plain prefetch.
  // Analytics.astro is guarded against firing a view during the offscreen prerender.
  experimental: { clientPrerender: true },

  // The admin editor moved from /admin/editor into the dashboard at /admin/write.
  // Keep the old path working (bookmarks) via a static redirect.
  redirects: { '/admin/editor': '/admin/write' },

  // Integrations run during the build. Only the sitemap generator is registered
  // here (RSS, Pagefind, OG images live in their own files — see top doc block).
  // filter: predicate deciding which discovered pages get written to the sitemap.
  //   Returning false OMITS the page. We exclude any URL under `/gated/` so the
  //   public sitemap never advertises paywalled posts to crawlers. SECURITY: this
  //   is discoverability hygiene, not enforcement — the actual paywall is the
  //   token/entitlement middleware + Supabase RLS. See top doc block.
  integrations: [sitemap({ filter: (page) => !page.includes('/gated/') && !page.includes('/post-shell') && !page.includes('/permalink-shell') && !page.includes('/admin') })],

  // Markdown/MDX compilation pipeline (Shiki syntax highlighting with ```d2
  // excluded, remark-math → rehype-katex, then rehype-d2 → inline SVG). Defined in
  // src/lib/markdown-config.mjs and shared verbatim with the render-at-publish path
  // so instantly-published posts render identically to this build. Edit it there.
  markdown: markdownConfig(rehypeD2),

  vite: {
    // The render-at-publish engine (src/lib/render-post-browser.mjs) runs
    // @astrojs/markdown-remark IN THE BROWSER. That package reads a Node global at
    // module load — `Boolean(process.env.ASTRO_PERFORMANCE_BENCHMARK)` — which is a
    // ReferenceError in the browser (and, once thrown, poisons the cached module).
    // Replace that token at bundle time so the browser build never touches `process`
    // during import. (Any later/runtime process access is covered by a small shim in
    // render-post-browser.mjs.) Harmless for the Node build — it's only a perf flag.
    define: {
      'process.env.ASTRO_PERFORMANCE_BENCHMARK': 'undefined',
    },
  },
});
