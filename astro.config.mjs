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
 * This is a STATIC Astro build. `npm run build` reads this file, produces a
 * `dist/` folder of pre-rendered HTML + assets, and `npm run deploy` (Wrangler
 * direct upload) pushes `dist/` to Cloudflare Pages. Everything configured here
 * runs ONCE at build time on the developer's/CI machine — never in the browser and
 * never in a Cloudflare Pages Function. The dynamic backend (Supabase/PostgREST +
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
 *     highlighting, and mermaid diagrams to render correctly.
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
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeD2 from './plugins/rehype-d2.mjs';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  // Canonical production origin. Consumed at build time to turn every relative
  // route into an absolute URL (sitemap entries, RSS <link>s, canonical tags, OG
  // image URLs). Must be the exact deployed origin, protocol included, no path.
  site: 'https://areyoustillreading.dev',

  // Integrations run during the build. Only the sitemap generator is registered
  // here (RSS, Pagefind, OG images live in their own files — see top doc block).
  // filter: predicate deciding which discovered pages get written to the sitemap.
  //   Returning false OMITS the page. We exclude any URL under `/gated/` so the
  //   public sitemap never advertises paywalled posts to crawlers. SECURITY: this
  //   is discoverability hygiene, not enforcement — the actual paywall is the
  //   token/entitlement middleware + Supabase RLS. See top doc block.
  integrations: [sitemap({ filter: (page) => !page.includes('/gated/') })],

  // Markdown/MDX compilation pipeline. Governs how post content becomes HTML.
  markdown: {
    // Syntax highlighting via Shiki (Astro's built-in), BUT with ```d2 fences
    // excluded. WHY: if Shiki highlighted d2 blocks it would wrap the diagram
    // source in <pre><code> spans, and rehype-d2 (a later rehype pass) would no
    // longer see raw fence text to convert into an SVG. Excluding the lang lets the
    // d2 source pass through untouched to that pass.
    syntaxHighlight: { type: 'shiki', excludeLangs: ['d2'] },

    // remark (Markdown-AST) plugins, run before rehype. remark-math tokenizes
    // `$…$` inline and `$$…$$` block math into math nodes for rehype-katex.
    remarkPlugins: [remarkMath],

    // rehype (HTML-AST) plugins, run in order:
    //   1. rehype-katex → converts the math nodes from remark-math into static,
    //      pre-rendered KaTeX HTML (no client-side JS/math library shipped).
    //   2. rehype-d2 (local) → finds the passed-through ```d2 fences and renders
    //      each to inline <svg> baked into the HTML at BUILD time via @terrastruct/d2's
    //      WASM engine — no headless browser/Chromium, no runtime diagram JS, no
    //      layout shift. This is why d2 must dodge Shiki above. KaTeX before d2 is
    //      fine — they operate on disjoint node types.
    rehypePlugins: [rehypeKatex, rehypeD2],

    // Shiki theme config: dual light/dark themes emitted as CSS-variable-driven
    // markup so code blocks follow the site's theme without re-highlighting.
    // wrap: true → long code lines soft-wrap instead of forcing horizontal
    // scroll (better on mobile / narrow columns).
    shikiConfig: {
      themes: { light: 'github-light', dark: 'github-dark' },
      wrap: true,
    },
  },
});
