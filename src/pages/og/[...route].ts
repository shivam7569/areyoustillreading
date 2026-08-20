/**
 * src/pages/og/[...route].ts
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE IS
 *   An Astro dynamic route that generates one Open Graph (social-share) PNG
 *   image per blog post. The `[...route]` rest-parameter filename means this
 *   single module owns the entire `/og/*` URL namespace; each emitted image is
 *   served at `/og/<post-id>.png` (e.g. `/og/my-first-post.png`).
 *
 * SINGLE RESPONSIBILITY
 *   Turn each published blog post's metadata (title + description) into a
 *   1200x630-ish branded PNG card that link-preview crawlers (Twitter/X,
 *   Slack, LinkedIn, Discord, iMessage, Facebook, etc.) fetch when someone
 *   shares a post URL. That is the ONLY thing this file does.
 *
 * WHEN IT RUNS  (important — this is NOT a runtime endpoint)
 *   Everything here executes at BUILD TIME, during `astro build`. That build is
 *   triggered by EITHER of the project's two deploy paths, and this file behaves
 *   identically for both:
 *     1. Manual Wrangler direct upload — `npm run deploy` runs the build locally
 *        then `wrangler pages deploy dist` uploads the static output.
 *     2. The publish pipeline — functions/api/publish.js commits a post's
 *        Markdown to GitHub, and Cloudflare Pages' Git integration rebuilds the
 *        site (running this file again to (re)generate the OG PNGs).
 *   Either way `getStaticPaths` is evaluated during the build and the resulting
 *   PNGs are written out as static assets. No Cloudflare Pages Function, no
 *   Supabase, no request-time code path touches this file. Consequently there
 *   are NO auth, RLS, token, entitlement, signature, or honeypot concerns in
 *   this module — it only ever sees data the build already has.
 *
 * HOW IT FITS THE ARCHITECTURE
 *   - Upstream: the `blog` content collection (Markdown/MDX under src/content,
 *     validated by its Zod schema which guarantees `title` and `description`).
 *   - Here: we render the OG cards.
 *   - Downstream: the site's <head> (layout / SEO component) is expected to
 *     emit `<meta property="og:image" content="/og/<id>.png">` pointing at the
 *     image this route produced. If a post's id here ever diverges from the id
 *     used to build that meta tag URL, the crawler gets a 404 and the share
 *     preview falls back to no image — so keep the id source consistent.
 *
 * DEPENDENCIES
 *   - `astro-og-canvas` (OGImageRoute): does the actual canvas layout + PNG
 *     encoding. It returns ready-made `getStaticPaths` and `GET` handlers.
 *   - `astro:content` (getCollection): reads the typed `blog` collection.
 *
 * GOTCHAS / THINGS TO KNOW BEFORE EDITING
 *   - Draft filtering happens HERE (`!data.draft`). Drafts get no OG image.
 *     This mirrors the draft exclusion the rest of the site applies to routes,
 *     RSS, and sitemap; keep them in sync or a "published" post could ship with
 *     a broken (missing) OG image, or a draft could leak a preview card.
 *   - `post.id` is the collection entry id (slug-ish). It becomes the URL path
 *     segment, so renaming a content file changes the OG image URL and can
 *     invalidate crawler caches / previously shared links.
 *   - The top-level `await` on getCollection/OGImageRoute is a build-time
 *     module await; it's fine because this evaluates during static generation.
 *   - `getImageOptions`' first arg (the path) is intentionally unused (`_path`);
 *     styling is derived purely from the page's frontmatter data.
 */
import { OGImageRoute } from 'astro-og-canvas';
import { getCollection } from 'astro:content';

// Generate a social-share PNG per blog post at /og/<id>.png (build time).
// Pull every NON-draft blog entry. The `!data.draft` predicate is the gate that
// keeps unpublished posts from getting a public OG image URL (see gotcha above).
const posts = await getCollection('blog', ({ data }) => !data.draft);

// Reshape the collection into the map OGImageRoute expects: { [id]: pageData }.
// The key (post.id) is what becomes the `/og/<id>.png` path segment; the value
// (post.data) is the validated frontmatter we read title/description from.
//
// Plus a single BRANDED DEFAULT card at `/og/aysr.png`. DB-served posts (/@handle/slug)
// are dynamic and unknown at build time, so they can't get a per-post PNG here; they point
// their og:image at this default so the share card is a valid branded image, never a 404.
// (Per-post OG for DB posts is a follow-on: a runtime satori/resvg-wasm Function.)
const pages = {
  ...Object.fromEntries(posts.map((post) => [post.id, post.data])),
  aysr: { title: 'areyoustillreading', description: 'Considered essays on LLM engineering and the systems underneath.' },
};

// OGImageRoute builds and returns Astro's two required route exports for us:
//   - getStaticPaths: enumerates one static path per entry in `pages`.
//   - GET:            renders/returns the PNG for a given path at build time.
// We re-export them so Astro treats this file as a normal static endpoint.
export const { getStaticPaths, GET } = await OGImageRoute({
  pages,
  // Called once per page to produce that card's visual options. `_path` (the
  // route path) is deliberately ignored — every card is styled identically and
  // only its text content varies, keeping brand consistency across all shares.
  getImageOptions: (_path, page) => ({
    // Big headline + supporting line pulled straight from post frontmatter.
    // The Zod schema guarantees both exist, so no null-guarding is needed here.
    title: page.title,
    description: page.description,
    // Dark near-black vertical gradient (RGB top -> bottom) = the site's brand
    // background. Values are the palette's surface/elevated-surface tones.
    bgGradient: [
      [15, 17, 21],
      [23, 26, 33],
    ],
    // Brand-blue accent stripe down the leading edge (inline-start = left in
    // LTR). Purely decorative branding, mirrors the site's accent color #2F5BFF.
    border: { color: [47, 91, 255], width: 12, side: 'inline-start' },
    // Breathing room around the text so titles don't crowd the card edges.
    padding: 72,
  }),
});
