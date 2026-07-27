# areyoustillreading

Personal site + technical blog + owned audience + per-post paywall + a **premium
in-browser writing studio** — a **static-first full-stack app**. Live at
**https://areyoustillreading.dev**.

This README is the single source of truth for the whole system. It is intentionally
exhaustive: you should be able to return after **two years** and rebuild your complete
mental model from this document plus the per-file doc comments (every source file carries
a thorough header explaining itself). Pair it with [`PLAN.md`](PLAN.md) for the running
history of decisions.

> **North-star principle** (holds for every feature): this project exists to deliver a
> **Porsche-grade, exquisite experience for the author AND the reader**. Never leak
> technical plumbing (slugs, keys, jargon) into the UI; auth is invisible; flows feel like
> Medium's. "It works" is not "done" — it must be beautiful.

---

## 1. What this is

A personal platform with four jobs:

1. **Portfolio** — resume (`/resume`) + downloadable PDF, projects (`/projects`).
2. **Technical blog** — Markdown posts with code highlighting, math, **D2 diagrams**, and
   **interactive Python/Plotly plots**.
3. **Owned audience + monetization** — email list, reader accounts, engagement features
   (comments, highlights, private notes), and a **per-post paywall**.
4. **A world-class admin writing studio** (`/admin/editor`) — a Medium-style WYSIWYG editor
   that renders diagrams and runs Python plots live, with one-click **publish** straight to
   the live site.

The site is **static by default** (SEO/speed/cost) and adds server behavior only where
required, via **Cloudflare Pages Functions**. There is no traditional always-on server.

---

## 2. Architecture at a glance

```
                          ┌──────────────────────────────────────────────┐
Browser ───────────────>  │ Cloudflare Pages  (static HTML/CSS/JS by Astro)│
   │                      │   /api/*     Pages Functions (serverless)      │─┐
   │                      │   /gated/*   gated fragments + _middleware      │ │
   │                      │   /admin/editor   the writing studio (client)   │ │
   │                      └──────────────────────────────────────────────┘ │
   │                                                                        ▼
   ├── Supabase JS (browser, anon key + user JWT, RLS enforced) ─> Supabase (Postgres + Auth)
   ├── Turnstile widget ───────────────────────────────────────> Cloudflare Turnstile
   ├── Dodo hosted checkout ───────────────────────────────────> Dodo Payments (Merchant of Record)
   │                                                                   │ webhook
   │                                                                   ▼
   │                                                          /api/dodo-webhook → entitlements
   │
   └── Editor "Publish" ──> /api/publish (admin session) ──> GitHub commit ──┐
                                                                             ▼
                                              Cloudflare Pages Git-integration rebuilds the site
```

- **Front end:** Astro 7, static output. The browser talks to Supabase directly with the
  **public anon key** — safe because every table is protected by **Row-Level Security**.
- **Server bits:** Cloudflare Pages Functions (`functions/`) use the **service-role key**
  for privileged work (email, token verification, writing entitlements, committing posts).
  `/gated/*` middleware enforces the paywall server-side.
- **Publishing:** the editor commits a post's Markdown to GitHub via `/api/publish`; the
  **Cloudflare Pages Git-integration** rebuilds and deploys. (This is "Option B": the
  static build pipeline stays the source of truth; the editor is just a fancy committer.)
- **Data + auth:** Supabase (Postgres via PostgREST + Supabase Auth: magic-link + GitHub).
- **Email:** Resend (transactional confirm emails + Supabase's SMTP for auth emails).
- **Payments:** Dodo Payments — a **Merchant of Record** (Stripe is not generally available
  in India; Dodo handles global tax and pays out to India).

---

## 3. Tech stack

| Area | Choice | Notes |
| --- | --- | --- |
| Generator | **Astro 7** (static) | Per-route SSR available later without a rewrite. |
| Markdown | `@astrojs/markdown-remark` | **Required** in Astro 7 — its default processor skips remark/rehype plugins; this restores the unified pipeline. |
| Highlighting | **Shiki** (dual light/dark) | Built into Astro; configured in `astro.config.mjs`. `excludeLangs: ['d2']` so D2 fences reach the D2 plugin as raw text. |
| Math | **KaTeX** (`remark-math` + `rehype-katex`) | Rendered at build; CSS imported in `BlogPost.astro`. |
| **Diagrams** | **D2** (`@terrastruct/d2` WASM, via `plugins/rehype-d2.mjs`) | **Replaced Mermaid.** Renders `d2` fences to inline SVG **at build time with no headless browser/Chromium**, and the same WASM renders live previews in the editor. |
| **Plots** | **Plotly** authored in **Python**, run client-side via **Pyodide** | In the editor only: a `python` code cell runs `plotly.py` in the browser (WASM) and renders an interactive plot below it. See §5. |
| Search | **Pagefind** | Post-build CLI over `dist/`; UI on `/blog`. Gated fragments carry `data-pagefind-ignore`. |
| Feeds/SEO | `@astrojs/rss`, `@astrojs/sitemap`, `astro-og-canvas` | `/rss.xml`, sitemap (excludes `/gated/`), per-post OG at `/og/<id>.png`. |
| **Editor** | **Milkdown "Crepe"** (ProseMirror) + CodeMirror | Medium-style WYSIWYG at `/admin/editor`. See §5. |
| Auth/DB | **Supabase** (`@supabase/supabase-js`) | Postgres + Auth; RLS everywhere; `public.admins` + `is_admin()`. |
| Email | **Resend** | Confirm emails via `lib/email.js`; also Supabase Auth SMTP. |
| Bot check | **Cloudflare Turnstile** | On the subscribe form; verified server-side. |
| Payments | **Dodo Payments** | Hosted checkout + Standard-Webhooks-verified webhook. |
| Host | **Cloudflare Pages** | Static assets + Functions. Git-integration builds + Wrangler direct upload both available. |
| Tests | **Vitest** | Builds the site, then asserts on the emitted `dist/`. |

**Runtime CDNs (editor only, admin-facing):** Pyodide + Python packages from jsDelivr,
`plotly.js` from `cdn.plot.ly`, `gifenc` from jsDelivr. These load lazily and only inside
the editor; **reader pages ship none of it**. D2 is bundled (no CDN).

---

## 4. Project structure

```
areyoustillreading/
├── astro.config.mjs        site URL, sitemap (excludes /gated/), markdown pipeline
│                           (Shiki dual theme, remark-math, rehype-katex, rehype-d2)
├── plugins/rehype-d2.mjs   BUILD-TIME: renders ```d2 fences → inline SVG via @terrastruct/d2 (no Chromium)
├── vitest.config.ts        Vitest: global setup builds the site, then tests read dist/
├── package.json            scripts: dev / build / preview / test / deploy / deploy:preview
├── PLAN.md                 living plan + every major decision (the "why")
│
├── public/                 copied verbatim to site root
│   ├── _headers            Cloudflare security headers (nosniff, HSTS, frame DENY, referrer)
│   ├── robots.txt · favicon.svg
│   └── resume.pdf          served but GIT-IGNORED (the owner's CV)
│
├── src/
│   ├── content.config.ts   blog content collection + zod frontmatter schema
│   ├── content/blog/*.md    the posts (filename = URL slug)
│   ├── styles/global.css   design tokens + base styles (light/dark)
│   ├── lib/
│   │   ├── supabase.ts      the browser Supabase client (anon key + user session)
│   │   ├── plotly.js        EDITOR: run plotly.py via Pyodide → figure JSON; load plotly.js; rotating-GIF export
│   │   └── pyplot.js        EDITOR: matplotlib-via-Pyodide prototype (kept; Plotly is the live path)
│   ├── layouts/
│   │   ├── BaseLayout.astro  html shell, nav, <BaseHead>, RSS link
│   │   └── BlogPost.astro    post shell: meta, tags, reading time; slots body; mounts Highlights/Notes/Comments
│   ├── components/
│   │   ├── BaseHead.astro · SubscribeForm.astro · Comments.astro
│   │   ├── Highlights.astro · Notes.astro · PaywallGate.astro
│   └── pages/
│       ├── index.astro · blog/index.astro · blog/[...slug].astro · blog/tags/…
│       ├── gated/[...slug].astro   FULL body of gateable posts — bare fragment, no-index
│       ├── admin/editor.astro      ★ the writing studio (see §5)
│       ├── og/[...route].ts · rss.xml.js · resume.astro · projects.astro
│       ├── login.astro · account.astro
│       └── check-inbox / subscribed / unsubscribed / subscribe-error / 404
│
├── functions/              Cloudflare Pages Functions (server-side; see §9)
│   ├── api/subscribe · confirm · unsubscribe        (email list)
│   ├── api/checkout · dodo-webhook                   (payments)
│   ├── api/publish.js                                (★ commit a post to GitHub)
│   └── gated/_middleware.js                          (paywall enforcement on /gated/*)
│
├── lib/email.js            shared helpers for the email Functions (Supabase REST, Resend, Turnstile)
├── db/                     SQL you run once each in the Supabase SQL editor (see §10)
└── tests/                  Vitest suite (global-setup builds; *.test.ts assert on dist/)
```

---

## 5. The admin writing studio (`/admin/editor`) ★

A Medium-inspired WYSIWYG editor built on **Milkdown "Crepe"** (a ProseMirror editor).
Everything the author writes serializes straight to the Markdown the site builds from, so
there is no separate content format. Implemented entirely in `src/pages/admin/editor.astro`
plus `src/lib/plotly.js`.

**Access model:** the editor page itself is currently **ungated** (you can write without
logging in; there's a standing task to gate it before any real public launch). **Publishing**
requires a one-time **Supabase sign-in** (see the publish modal below) — that is the real
authorization boundary.

Features:

- **WYSIWYG Markdown** with live inline rendering (headings, lists, **KaTeX math as you
  type**, tables, images, slash `/` block menu, floating toolbar).
- **Language-aware code blocks** (CodeMirror + `@codemirror/language-data`).
- **Bracket/quote auto-pairing**, blog-wide, via a small ProseMirror `$prose` plugin
  (`()[]{}""''`). Backtick is deliberately NOT paired (it collides with Markdown's own
  code-fence/inline-code shortcuts). Code blocks get the same via CodeMirror `closeBrackets`.
- **D2 diagrams, live.** A ` ```d2 ` block renders its diagram in the block's preview panel
  via `@terrastruct/d2`'s **browser WASM** (lazy-loaded). The published site renders the
  same fence at build time (`plugins/rehype-d2.mjs`), so editor preview and live output match.
- **Interactive Python plot cells (notebook-style).** A ` ```python ` block runs client-side
  via **Pyodide** (CPython in WebAssembly, lazy-loaded from jsDelivr) and its result renders
  **right below the code**:
  - If the script builds a **Plotly** figure (assign it to `fig`), it renders as a fully
    **interactive** `plotly.js` plot (rotate/zoom/pan 3D). Runs are **serialized** through
    the single Pyodide interpreter and **debounced**; panels are ProseMirror **widget
    decorations** keyed by block index so they persist while you edit.
  - Otherwise the cell behaves like a notebook cell and shows its **stdout** in an output
    block. `numpy` + `pandas` are preloaded; other imports auto-load on demand.
  - **Rotating-GIF export:** 3D plots get a "Download GIF" control (frames + fps) that sweeps
    the camera 360°, snapshots each frame, and encodes a GIF client-side (`gifenc`).
  - `fig.show()` and a hard-coded `width`/`height` are handled gracefully (recovered / stripped
    so the plot fits the column). *(Reader-side interactive plots on published pages are still
    to be built — see §16.)*
- **Draft autosave.** The Markdown is saved to `localStorage` (debounced) and restored on
  reload; a **New** button (two-click confirm) clears it. *(Migrates to per-user Supabase
  drafts once the editor is gated.)*
- **Premium Publish modal.** A clean, Medium-style modal — **Title** (pre-filled from the
  first `# H1`), **Description**, **tags as chips**, a subtle auto **permalink** (editable),
  a **Draft** toggle, one **Publish** button. **No slugs or secrets in the UI.** If you're
  not signed in it shows a one-time sign-in (GitHub / email magic link); after that,
  publishing just works. On publish it assembles the frontmatter + body and POSTs to
  `/api/publish` with your Supabase access token.

---

## 6. Publishing pipeline (Option B)

```
Editor "Publish" modal
  → builds:  ---\n title/description/pubDate/tags/draft \n---\n\n <body markdown>
  → POST /api/publish   (Authorization: Bearer <supabase access_token>, { slug, content })
      → publish.js verifies the token is a signed-in admin (public.admins)
      → GitHub Contents API PUT src/content/blog/<slug>.md   (create, or update via blob sha)
  → Cloudflare Pages Git-integration sees the commit → runs `npm run build` → deploys
```

- A **200 from `/api/publish` means "committed", not "already live"** — the rebuild is async
  (~1–2 min).
- The commit target branch is `GITHUB_BRANCH` (default `main` → production). Set it to a
  non-production branch (e.g. `dev`) on the **Preview** environment to publish-test against
  the preview build without touching production. The **Draft** toggle also keeps a test post
  out of listings.
- Everything a post can contain renders at build: prose, Shiki code, KaTeX math, and **D2
  diagrams**. (Interactive plots for readers are the remaining piece — §16.)

---

## 7. Diagrams: D2 (replaced Mermaid)

- **Authoring:** ` ```d2 ` fenced blocks (the D2 language — flowcharts, architecture,
  sequence, ER/`sql_table`, `class`, nested containers, themes, sketch mode).
- **Build:** `plugins/rehype-d2.mjs` finds `d2` fences (Shiki skips them) and renders each to
  inline `<svg>` with `@terrastruct/d2`'s **Node WASM** engine — **no Chromium**. It spawns a
  D2 instance only for files that contain a diagram and **terminates the worker** after, so
  `astro build` exits cleanly.
- **Editor preview:** the same package's **browser WASM** renders live previews.
- **Why D2 over Mermaid:** prettier + more capable, and — decisively — it renders **without a
  headless browser**, so the build no longer needs `npx playwright install chromium` (faster,
  lighter, more reliable builds). Chosen after a deep-research pass + an all-around prototype.
- **Caveat:** the JS wrapper `@terrastruct/d2` is pinned at `0.1.33` (pre-1.0, works end-to-end;
  watch for a stable 1.0). Dev-server quirk: adding the dep can leave a code block stuck on a
  `milkdown-code-block-placeholder` — restart `npm run dev` (production is unaffected).

---

## 8. Environment & dev workflow

Prereqs: **Node ≥ 22.12**, npm, git. Windows-friendly (built on Windows).

Because iterating directly on production is painful (each deploy changes hashed chunk names
and the custom domain briefly serves a stale chunk), development uses **three surfaces**:

| Surface | Command / trigger | URL |
| --- | --- | --- |
| **Local** | `npm run dev` | http://localhost:4321 — primary iteration + testing (HMR, no deploy, no cache) |
| **Preview** | `npm run deploy:preview` (Wrangler) **or** push the `dev` branch (Git-integration) | `preview.areyoustillreading.pages.dev` + a fresh unique `<hash>.pages.dev` per deploy (use the unique URL to dodge alias cache lag) |
| **Production** | `npm run deploy` (Wrangler) **or** merge/push `main` (Git-integration) | https://areyoustillreading.dev — intentional releases only |

Git branches: ongoing work on **`dev`**; **`main`** tracks production. Promote by merging
`dev` → `main`. Git author is `shivam7569`; **Claude co-authorship stays disabled.**

```bash
npm install
npm run dev            # local dev server
npm run build          # astro build + pagefind → dist/  (NO Chromium needed anymore)
npm run preview        # serve the production build locally
npm test               # builds, then Vitest assertions on dist/
npm run deploy         # build + wrangler pages deploy dist  (production)
npm run deploy:preview # build + wrangler pages deploy dist --branch=preview
```

> Auth/DB/email/payments/publish only fully work when deployed (Functions run on Cloudflare)
> and when the env in §9 is set. `npm run dev` renders the UI; `/api/*` behaves fully only in
> production/preview (or `wrangler pages dev`).

---

## 9. Environment variables & secrets

**Public** values are embedded in the client bundle at build time; **secrets** are only
available to the Functions at runtime and never in the repo.

### Public (build-time) — `.env` at repo root (GIT-IGNORED)

| Var | What |
| --- | --- |
| `PUBLIC_SUPABASE_URL` | Supabase project URL |
| `PUBLIC_SUPABASE_ANON_KEY` | Supabase **anon** key (public by design; RLS protects data) |
| `PUBLIC_TURNSTILE_SITE_KEY` | Cloudflare Turnstile **site** key (public) |

A fresh clone must re-create `.env` before a local build (we bake these at build time).

### Secrets (runtime) — Cloudflare Pages project env vars

| Secret | Used by | What |
| --- | --- | --- |
| `SUPABASE_URL` | all Functions | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | all Functions | Supabase **service-role** key (bypasses RLS — server only) |
| `RESEND_API_KEY` | subscribe | Resend API key (also Supabase SMTP password) |
| `TURNSTILE_SECRET_KEY` | subscribe | Turnstile secret (server-side verify) |
| `DODO_API_KEY` | checkout | Dodo API key (test or live) |
| `DODO_WEBHOOK_SECRET` | dodo-webhook | Dodo webhook signing secret |
| `DODO_API_BASE` *(opt)* | checkout | default `https://test.dodopayments.com`; live = `https://dodopayments.com` |
| **`GITHUB_TOKEN`** | publish | fine-grained PAT, **Contents: write** on the repo |
| `GITHUB_REPO` *(opt)* | publish | `owner/name` (default `shivam7569/areyoustillreading`) |
| `GITHUB_BRANCH` *(opt)* | publish | commit target (default `main`; set `dev` on Preview env to test safely) |

Supabase also needs **custom SMTP** (Authentication → SMTP) via Resend
(`smtp.resend.com:465`, user `resend`, password = a Resend API key) so auth emails send from
`hello@areyoustillreading.dev`.

> There is **no `PUBLISH_SECRET`** — publish auth is the author's normal Supabase admin
> session, verified server-side. (An earlier design used a typed secret; it was removed.)

---

## 10. Cloudflare Functions reference

| Route | Method | Purpose | Key env |
| --- | --- | --- | --- |
| `/api/subscribe` | POST | Double-opt-in: Turnstile → honeypot → insert pending → Resend confirm email. No email enumeration; 5-min cooldown. | SUPABASE_*, RESEND_API_KEY, TURNSTILE_SECRET_KEY |
| `/api/confirm?token=` | GET | Confirm a subscription (idempotent). | SUPABASE_* |
| `/api/unsubscribe?token=` | GET | One-click unsubscribe. | SUPABASE_* |
| `/api/checkout` | POST | Verify user token → look up the post's Dodo `product_id` → create hosted checkout with `metadata {post_id,user_id}` → return `{url}`. | SUPABASE_*, DODO_API_KEY |
| `/api/dodo-webhook` | POST | Verify Standard-Webhooks signature (HMAC-SHA256 over `id.timestamp.payload`) → on `payment.succeeded`, upsert an `entitlements` row. | DODO_WEBHOOK_SECRET, SUPABASE_* |
| **`/api/publish`** | POST | **Verify a signed-in admin session** → commit `src/content/blog/<slug>.md` to GitHub (create/update). Body `{slug, content}`, `Authorization: Bearer <supabase token>`. | GITHUB_TOKEN, SUPABASE_* |
| `/gated/*` | middleware | Gate full-content fragments: if not paywalled → serve; else require a valid Supabase token AND (admin OR entitlement), else **403**. Fails safe (locked). | SUPABASE_* |

### Paywall architecture (the important one)

- A post is monetizable only if authored with `gateable: true`. Such posts render **only the
  preview** on `/blog/<slug>` (`<PaywallGate>`); the **full body is never in static HTML, RSS,
  sitemap, or search** (verified by `tests/paywall.test.ts`).
- The full body is emitted as a bare fragment at `/gated/<slug>`, gated by
  `functions/gated/_middleware.js`; the browser fetches it with the reader's Supabase JWT.
- Admin toggle (`PaywallGate.astro`) writes `post_paywall` (`is_paid`, `price_cents`,
  `product_id`). A post that was ever fully public can't be retroactively locked — that's why
  monetizable posts are preview-only from day one.
- Purchase: **Unlock** → `/api/checkout` → Dodo checkout → pay → **webhook** →
  `/api/dodo-webhook` writes the entitlement → the gate serves the body.

---

## 11. Data model (Supabase) & setup order

RLS is enabled on **every** table. Run each file once in the Supabase **SQL editor**, in
order (later files reuse `is_admin()` from `highlights.sql`):

1. `db/schema.sql` — **subscribers**. RLS on, **no policies** → only service-role Functions touch it.
2. `db/comments.sql` — **comments** (public). RLS: select `true`; insert/delete `auth.uid()=user_id`.
3. `db/highlights.sql` — **admins** (`insert into public.admins (user_id) values ('<your-uuid>')`),
   `is_admin()` (plpgsql, security-definer), **highlights**, **highlight_comments** (own-or-admin).
4. `db/notes.sql` — **notes** (one per post per reader; own-or-admin).
5. `db/entitlements.sql` — **entitlements** `(user_id, post_id)`. RLS: select own only; only the webhook writes.
6. `db/post_paywall.sql` — **post_paywall** `(post_id, is_paid, price_cents, currency, product_id)`.

> `is_admin()` is deliberately **`language plpgsql`** — a `language sql` version fails to create
> in the Supabase editor (its body is validated before `admins` is visible in the same
> transaction). **Your Supabase user must be in `public.admins`** to publish (§5/§10).

---

## 12. Testing

`npm test` runs Vitest. `tests/global-setup.ts` runs `npm run build` once (a green build is
itself the first gate), then each `tests/*.test.ts` asserts on the emitted `dist/` — pages
exist, markup markers present, feeds/sitemap correct, and crucially **paid bodies never leak**
into public output. Nothing advances until `npm test` is green. Current: **44 tests / 22 files.**

---

## 13. Deployment

- **Cloudflare Pages Git-integration** (primary): the repo is connected in the dashboard;
  **production branch `main`**, build command **`npm run build`**, output `dist/`. A push (or a
  `/api/publish` commit) to `main` → production build; a push to `dev` → preview build. **No
  Chromium in the build command** — D2 removed that need.
- **Wrangler direct upload** (also available): `npm run deploy` (production) / `npm run
  deploy:preview` (preview) build locally and upload `dist/`. Handy for a quick deploy without
  a git push. Env vars set in the Pages project apply to both deploy paths.
- Custom domain `areyoustillreading.dev` is attached in the Pages dashboard (DNS + HTTPS
  automatic — the domain is in the same Cloudflare account).

### Going live on payments (from test mode)

1. Create **live** product(s) in Dodo; set each product id on its post via the admin toggle.
2. Set `DODO_API_KEY` (live) and `DODO_API_BASE = https://dodopayments.com`.
3. Create a **live** Dodo webhook → `https://areyoustillreading.dev/api/dodo-webhook`
   (`payment.succeeded`) → set `DODO_WEBHOOK_SECRET`.
4. Remove the demo post `src/content/blog/premium-example.md`.

---

## 14. Security notes

- **RLS on every table.** The browser only holds the anon key + the user's JWT; the
  service-role key exists only inside Functions.
- **Paywall is server-side** and fails safe (locked) on any error.
- **`/api/publish`** holds repo-write access and is gated by a verified **admin Supabase
  session** (token validated by Supabase, admin membership checked with the service role).
- **Webhook** signatures are HMAC-verified before writing entitlements. **Subscribe** has a
  honeypot, per-email cooldown, no-enumeration responses, and Turnstile.
- **Secrets** never enter the repo; `public/resume.pdf` and `reference_files/` are git-ignored.
  Security headers ship via `public/_headers`.
- **Editor is ungated** for dev (write without login); publishing is the auth boundary. Re-gate
  the editor page before a real public launch (task tracked).

---

## 15. Gotchas learned (so you don't rediscover them)

- Astro 7's default Markdown processor ignores remark/rehype plugins → install
  **`@astrojs/markdown-remark`**.
- `_`-prefixed folders under `src/pages/` are **not routed** → the gated route is
  `src/pages/gated/…` with the middleware at `functions/gated/_middleware.js`.
- Resend refuses to send until the **domain is verified** ("added" ≠ "verified").
- `is_admin()` must be **plpgsql**.
- Dodo requires a **pre-created product** (no ad-hoc amounts) → each paid post stores a
  `product_id`.
- **D2 (`@terrastruct/d2`) Node build runs on a worker_thread** — terminate it after use or
  `astro build` hangs (handled in `plugins/rehype-d2.mjs`). It also embeds WASM; adding it can
  wedge the Vite dev optimizer → restart `npm run dev`.
- **Pyodide/Plotly** are lazy-loaded from CDNs and run **only in the editor**; concurrent plot
  cells must be **serialized** through the one Pyodide interpreter (they'd otherwise race on a
  shared global and render each other's output).
- Milkdown/Crepe's code-block preview goes through an SVG-aware **DOMPurify** — D2/Plotly SVG
  survives it; interactive controls do not (that's why plot cells use ProseMirror widget
  decorations, not the sanitized preview).
- Complex shell one-liners (`$(...)` capture, `;`-chains) trigger permission prompts even when
  binaries are allow-listed → prefer plain single commands.

---

## 16. Roadmap

- **Phase 1 — Free site + owned subscribe.** ✅ live.
- **Phase 2 — Auth + engagement (comments, highlights + discussion, private notes).** ✅
- **Phase 3 — Per-post paywall (Dodo MoR).** ✅ (test mode; flip to live per §13).
- **Phase 4 — Writing studio.** In progress: WYSIWYG editor ✅, D2 diagrams ✅, interactive
  Python/Plotly plot cells ✅, GIF export ✅, notebook output ✅, localStorage drafts ✅, premium
  publish modal + `/api/publish` (Git-integration) ✅. **Remaining:**
  - **Reader-side interactive plots** — bake each plot's figure JSON at publish so published
    pages render the interactive `plotly.js` plot (no Pyodide for readers) with collapsible code.
  - **Admin dashboard** — manage posts/paywall/subscribers in one place.
  - **Re-gate the editor** + migrate drafts to per-user Supabase.
- **Phase 5 — UI/UX design refinement** (the Porsche-grade polish pass across the whole site).
