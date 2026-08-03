# areyoustillreading

Personal site + technical blog + owned audience + per-post paywall + a **premium
in-browser writing Studio** — a **static-first full-stack app**. Live at
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

1. **Portfolio** — resume (`/resume`) + downloadable PDF, projects case study (`/projects`).
   Both are **data-driven** (`src/data/resume.json`, `src/data/projects.json`) and edited
   from the Studio — never hand-edited HTML.
2. **Technical blog** — Markdown posts with code highlighting, math, **D2 diagrams**, and
   **interactive Python/Plotly plots that also render for readers**. Archive, per-tag and
   per-topic pages, and **multi-part series** (`/series`).
3. **Owned audience + monetization** — email list (double opt-in), reader accounts,
   engagement features (comments, highlights + discussion, private notes), **first-party
   cookieless analytics**, a **newsletter broadcast on publish**, and a **per-post paywall**.
4. **A world-class admin Studio** (`/admin`) — a control center for the whole site: a
   Medium-style WYSIWYG **editor** (`/admin/write`) that renders diagrams and runs Python
   plots live; dashboards for posts, drafts, audience, engagement, analytics and revenue;
   Studio editors for the **resume**, **projects**, and **all site copy** (Content
   Management); one-click **publish** straight to the live site.

The site is **static by default** (SEO/speed/cost) and adds server behavior only where
required, via **Cloudflare Pages Functions**. There is no traditional always-on server.

---

## 2. Architecture at a glance

```
                          ┌──────────────────────────────────────────────┐
Browser ───────────────>  │ Cloudflare Pages  (static HTML/CSS/JS by Astro)│
   │                      │   /api/*     Pages Functions (serverless)      │─┐
   │                      │   /gated/*   gated fragments + _middleware      │ │
   │                      │   /admin/*   the Studio (client, admin-gated)   │ │
   │                      └──────────────────────────────────────────────┘ │
   │                                                                        ▼
   ├── Supabase JS (browser, anon key + user JWT, RLS enforced) ─> Supabase (Postgres + Auth)
   ├── /api/track beacon (cookieless) ─────────────────────────> analytics_events
   ├── Turnstile widget ───────────────────────────────────────> Cloudflare Turnstile
   ├── Dodo hosted checkout ───────────────────────────────────> Dodo Payments (Merchant of Record)
   │                                                                   │ webhook
   │                                                                   ▼
   │                                                          /api/dodo-webhook → entitlements
   │
   └── Studio "Publish"/"Save" ──> /api/publish · /api/admin/* (admin session) ──> GitHub commit ──┐
                                                                                                    ▼
                                                     Cloudflare Pages Git-integration rebuilds the site
```

- **Front end:** Astro 7, static output. The browser talks to Supabase directly with the
  **public anon key** — safe because every table is protected by **Row-Level Security**.
- **Server bits:** Cloudflare Pages Functions (`functions/`) use the **service-role key**
  for privileged work (email, token verification, writing entitlements, committing content).
  `/gated/*` middleware enforces the paywall server-side; `/blog/*` middleware overlays a
  just-published post before the git rebuild lands (instant-publish).
- **Publishing + content editing:** the Studio commits Markdown posts (`/api/publish`) and
  data files (`/api/admin/{resume,projects,site,post}`) to GitHub via the Contents API; the
  **Cloudflare Pages Git-integration** rebuilds and deploys. (This is "Option B": the static
  build pipeline stays the source of truth; the Studio is a fancy committer.)
- **Data + auth:** Supabase (Postgres via PostgREST + Supabase Auth: magic-link + GitHub).
- **Email:** Resend (transactional confirm emails, the newsletter broadcast, and Supabase's
  SMTP for auth emails).
- **Payments:** Dodo Payments — a **Merchant of Record** — with a **single reusable
  Pay-What-You-Want product**; the reader pays the admin-set per-post price.

---

## 3. Tech stack

| Area | Choice | Notes |
| --- | --- | --- |
| Generator | **Astro 7** (static) | Per-route SSR available later without a rewrite. |
| Markdown | `@astrojs/markdown-remark` | **Required** in Astro 7 — its default processor skips remark/rehype plugins; this restores the unified pipeline (`src/lib/markdown-config.mjs`). |
| Highlighting | **Shiki** (dual light/dark) | Built into Astro. `excludeLangs: ['d2']` so D2 fences reach the D2 plugin as raw text. Code chrome via `rehype-code-chrome.mjs`. |
| Math | **KaTeX** (`remark-math` + `rehype-katex`) | Rendered at build; CSS imported in `BlogPost.astro`. |
| **Diagrams** | **D2** (`@terrastruct/d2` WASM, via `plugins/rehype-d2.mjs`) | **Replaced Mermaid.** Renders `d2` fences to inline SVG **at build time with no headless browser/Chromium**; the same WASM (`rehype-d2-browser.mjs`) renders live previews in the editor. |
| **Plots** | **Plotly** authored in **Python** | Editor runs `plotly.py` via **Pyodide** (WASM) for a live preview; publish **bakes the figure JSON** so **readers get the interactive plot with no Pyodide** (`rehype-plotly.mjs` + `PlotlyReader.astro`). See §5. |
| Search | **Pagefind** | Post-build CLI over `dist/`. Gated fragments carry `data-pagefind-ignore`. |
| Feeds/SEO | `@astrojs/rss`, `@astrojs/sitemap`, `astro-og-canvas` | `/rss.xml`, sitemap (excludes `/gated/`), per-post OG at `/og/<id>.png`. |
| **Editor** | **Milkdown "Crepe"** (ProseMirror) + CodeMirror | Medium-style WYSIWYG at `/admin/write`. See §5. |
| Design | **Editorial** design system (Phase 5) | Refined-minimal skin in `styles/global.css`: Inter (UI) + **self-hosted serifs** (display + Charter body), a token scale, sticky blurred header, dark-adaptive D2, generated "plate" artwork (`lib/plates.mjs`). |
| Analytics | **First-party, cookieless** | A tiny beacon → `/api/track` → `analytics_events`; surfaced in Studio → Analytics. No third-party script; `?noanalytics=1` opt-out. |
| Auth/DB | **Supabase** (`@supabase/supabase-js`) | Postgres + Auth; RLS everywhere; `public.admins` + `is_admin()`. |
| Email | **Resend** | Confirm emails + the newsletter broadcast via `lib/email.js`; also Supabase Auth SMTP. |
| Bot check | **Cloudflare Turnstile** | On the subscribe form; verified server-side. |
| Payments | **Dodo Payments** | Hosted **Pay-What-You-Want** checkout + Standard-Webhooks-verified webhook. |
| Host | **Cloudflare Pages** | Static assets + Functions + a **KV** binding (rate-limiting + instant-publish). Git-integration builds and Wrangler direct upload both available. |
| Tests | **Vitest** | Builds the site, then asserts on the emitted `dist/`. |

**Runtime CDNs (editor only, admin-facing):** Pyodide + Python packages from jsDelivr,
`plotly.js` from `cdn.plot.ly`, `gifenc` from jsDelivr. These load lazily and only inside
the editor; **reader pages ship none of it** (reader plots are baked JSON + `plotly.js`).
D2 is bundled (no CDN).

---

## 4. Project structure

```
areyoustillreading/
├── astro.config.mjs        site URL, sitemap (excludes /gated/), markdown pipeline
│                           (Shiki dual theme, remark-math, rehype-katex, rehype-d2, rehype-plotly)
├── plugins/rehype-d2.mjs   BUILD-TIME: renders ```d2 fences → inline SVG via @terrastruct/d2 (no Chromium)
├── vitest.config.ts        Vitest: global setup builds the site, then tests read dist/
├── package.json            scripts: dev / build / preview / test / deploy / deploy:preview
├── PLAN.md                 living plan + every major decision (the "why")
│
├── public/
│   ├── _headers            Cloudflare security headers + ENFORCING Content-Security-Policy
│   ├── fonts/              self-hosted editorial serifs (woff2)
│   ├── robots.txt · favicon.svg (theme-aware)
│   └── resume.pdf          served AND committed (the downloadable CV)
│
├── src/
│   ├── content.config.ts   blog content collection + zod frontmatter schema (incl. series + gateable)
│   ├── content/blog/*.md    the posts (filename = URL slug)
│   ├── data/               ★ DATA-DRIVEN CONTENT (edited in the Studio, committed via /api/admin/*)
│   │   ├── resume.json      the resume page model
│   │   ├── projects.json    the projects case-study model
│   │   └── site.json        ★ site-wide page COPY (every page, keyed) — Content Management
│   ├── styles/global.css   Editorial design tokens + base styles (light/dark)
│   ├── lib/
│   │   ├── supabase.ts      browser Supabase client (anon key + user session)
│   │   ├── admin-gate.ts    Studio auth gate: checkAdmin / adminFetch / onAdminReady / swrFetch
│   │   ├── admin-format.ts  shared Studio formatters
│   │   ├── plates.mjs       deterministic theme-aware SVG "plates" (projects artwork)
│   │   ├── series.ts · series-picker.ts   series grouping + editor picker
│   │   ├── markdown-config.mjs             shared remark/rehype pipeline
│   │   ├── rehype-code-chrome.mjs · rehype-d2-browser.mjs · rehype-plotly.mjs
│   │   ├── render-post.mjs · render-post-browser.mjs · assemble-post.mjs
│   │   ├── plotly.js        EDITOR: run plotly.py via Pyodide → figure JSON; rotating-GIF export
│   │   └── pyplot.js        EDITOR: matplotlib-via-Pyodide prototype (kept; Plotly is the live path)
│   ├── layouts/
│   │   ├── BaseLayout.astro   html shell, nav/footer, <BaseHead>, RSS link, theme toggle
│   │   ├── BlogPost.astro     post shell: byline, tags, reading time; slots body; mounts islands
│   │   └── AdminLayout.astro  ★ the Studio shell: grouped sidebar nav, gate, account row
│   ├── components/
│   │   ├── BaseHead.astro · SubscribeForm.astro · ShareBar.astro · Analytics.astro
│   │   ├── SeriesNav.astro · PlotlyReader.astro
│   │   └── Comments.astro · Highlights.astro · Notes.astro · PaywallGate.astro
│   └── pages/
│       ├── index.astro · about.astro · blog/index.astro · blog/[...slug].astro
│       ├── blog/tags/index.astro · blog/tags/[tag].astro · series.astro
│       ├── gated/[...slug].astro   FULL body of gateable posts — bare fragment, no-index
│       ├── resume.astro · projects.astro · og/[...route].ts · rss.xml.js
│       ├── login.astro · account.astro
│       ├── check-inbox / subscribed / unsubscribed / subscribe-error / 404
│       └── admin/            ★ THE STUDIO (admin-gated; see §5)
│           ├── index.astro (dashboard) · write.astro (the editor) · posts · drafts
│           ├── projects · resume · content (Content Management)
│           ├── audience · engagement · analytics · revenue · series · settings
│
├── functions/              Cloudflare Pages Functions (server-side; see §10)
│   ├── api/subscribe · confirm · unsubscribe            (email list)
│   ├── api/checkout · dodo-webhook                       (payments — price-only PWYW)
│   ├── api/track                                         (cookieless analytics beacon)
│   ├── api/publish.js · api/admin/post.js                (commit a post to GitHub)
│   ├── api/admin/{resume,projects,site}.js              (★ commit the data files)
│   ├── api/admin/{overview,posts,subscribers,analytics,sales,comments}.js  (dashboards, read)
│   ├── api/admin/{broadcast,digest,early}.js            (newsletter broadcast / digest / early access)
│   ├── blog/_middleware.js                               (instant-publish overlay on /blog/*)
│   └── gated/_middleware.js                              (paywall enforcement on /gated/*)
│
├── lib/email.js            shared helpers for the email Functions (Supabase REST, Resend, Turnstile)
├── db/                     SQL you run once each in the Supabase SQL editor (see §11)
└── tests/                  Vitest suite (global-setup builds; *.test.ts assert on dist/)
```

---

## 5. The admin Studio (`/admin`) ★

The Studio is the site's control center — a client-rendered, **admin-gated** dashboard
(`src/layouts/AdminLayout.astro` supplies the shell: a grouped sidebar, a "checking → sign
in → denied → revealed" gate via `src/lib/admin-gate.ts`, and the account row). Every
`/admin/*` page and every `/api/admin/*` endpoint **independently** verifies a signed-in
admin — link/UI visibility is never the security boundary.

**The pages:**

- **Dashboard** (`/admin`) — the overview.
- **Write** (`/admin/write`) ★ — the WYSIWYG editor (details below). *Publishing* requires a
  one-time Supabase sign-in; that is the real authorization boundary.
- **Posts / Drafts** — manage published posts (visibility, paywall + price, series, email
  broadcast, early access, delete) and server-side per-user drafts.
- **Projects / Resume** — Studio editors that write `src/data/projects.json` /
  `resume.json` (+ the committed `resume.pdf`); the public pages render from those files.
- **Content Management** (`/admin/content`) ★ — one screen to edit **every page's copy**
  across the whole site (`src/data/site.json`), keyed by page, chosen from a page-picker.
  Schema-driven: adding a page is one entry + pointing that page at `site.json`. See §5a.
- **Audience / Engagement / Analytics / Revenue** — subscribers, comments/highlights/notes,
  first-party analytics, and sales.
- **Series / Settings** — series management and site settings.

**The editor** (`/admin/write`) — a Medium-inspired WYSIWYG built on **Milkdown "Crepe"**
(ProseMirror). Everything serializes straight to the Markdown the site builds from.

- **WYSIWYG Markdown** with live inline rendering (headings, lists, **KaTeX math as you
  type**, tables, images, slash `/` block menu, floating toolbar).
- **Language-aware code blocks** (CodeMirror + `@codemirror/language-data`), bracket/quote
  auto-pairing (backtick excluded — it collides with Markdown fences).
- **D2 diagrams, live** — a ` ```d2 ` block previews via `@terrastruct/d2` browser WASM; the
  published site renders the same fence at build (`plugins/rehype-d2.mjs`), so they match.
- **Interactive Python plot cells** — a ` ```python ` block runs client-side via **Pyodide**
  and renders its result below the code: a **Plotly** figure (assign to `fig`) becomes a
  fully interactive plot (rotate/zoom/pan 3D); otherwise the cell shows **stdout** like a
  notebook. Runs are serialized through the one interpreter and debounced; `numpy`+`pandas`
  preloaded. **Rotating-GIF export** sweeps a 3D camera 360° and encodes a GIF (`gifenc`).
  **On publish the figure JSON is baked** so readers see the interactive plot with
  collapsible code and **no Pyodide** (`rehype-plotly.mjs` + `PlotlyReader.astro`).
- **Draft autosave** to the server (per-user Supabase drafts, `db/drafts.sql`), with a
  localStorage fallback.
- **Premium Publish modal** — Title (pre-filled from the first `# H1`), Description, tags as
  chips, a subtle auto permalink (editable), Draft toggle, optional **"email subscribers"**
  (fires the newsletter broadcast), series fields, one Publish button. **No slugs or secrets
  in the UI.** On publish it assembles frontmatter + body and POSTs to `/api/publish`.

### 5a. Content Management (site-wide editable copy)

Every user-visible string on the site is editable from **Studio → Content** without touching
code. Mechanism:

- **Store:** `src/data/site.json`, keyed by page (`home`, `projects`, `about`, `global`,
  `blogIndex`, `series`, `login`, `account`, the status pages, …). Public pages import it at
  build and read their section **with fallbacks** to the original text (nothing renders blank).
- **Editor:** `src/pages/admin/content.astro` renders a **page-picker** + grouped fields from
  a `PAGES` schema (dot-paths, text/area). Adding a page = one schema entry + one `site.json`
  section + pointing that page at `site.json`. No new screen/endpoint.
- **Endpoint:** `POST /api/admin/site` commits `site.json` → rebuild.
- **Patterns:** headline italics use a `*asterisk*` → `<em>` convention (build-time,
  `set:html`); inline links use a `{token}` filled at build; and **copy that lives in a
  component's client `<script>`** (status messages, JS-built rows) is handed to the script
  via a `<script type="application/json" id="…-copy">` block it parses at runtime (used on
  Login + Account), or via a `data-*` attribute for single strings.

---

## 6. Publishing pipeline (Option B)

```
Studio "Publish" modal
  → builds:  ---\n title/description/pubDate/tags/series/draft/gateable \n---\n\n <body markdown>
  → POST /api/publish   (Authorization: Bearer <supabase access_token>, { slug, content })
      → publish.js verifies the token is a signed-in admin (public.admins)
      → GitHub Contents API PUT src/content/blog/<slug>.md   (create, or update via blob sha)
      → (optional) newsletter broadcast to confirmed subscribers via Resend
  → Cloudflare Pages Git-integration sees the commit → runs `npm run build` → deploys
  → meanwhile functions/blog/_middleware.js overlays the new post into /blog until the rebuild lands
```

- A **200 from `/api/publish` means "committed", not "already live"** — the rebuild is async
  (~1–2 min); the instant-publish middleware bridges the gap.
- The commit target branch is `GITHUB_BRANCH` (default `main` → production). Set it to a
  non-production branch (e.g. `dev`) on the **Preview** environment to publish-test safely.
- The same commit-to-GitHub pattern backs the data files: `/api/admin/{resume,projects,site}`
  commit `src/data/*.json`, and `/api/admin/post` edits a post's frontmatter.
- Everything a post can contain renders at build: prose, Shiki code, KaTeX math, **D2
  diagrams**, and **baked interactive Plotly plots**.

---

## 7. Diagrams: D2 (replaced Mermaid)

- **Authoring:** ` ```d2 ` fenced blocks (flowcharts, architecture, sequence, ER/`sql_table`,
  `class`, nested containers, themes, sketch mode).
- **Build:** `plugins/rehype-d2.mjs` renders each `d2` fence to inline `<svg>` with
  `@terrastruct/d2`'s **Node WASM** engine — **no Chromium**. It spawns a D2 instance only for
  files with a diagram and **terminates the worker** after, so `astro build` exits cleanly.
  Diagrams are dark-adaptive via CSS-var theming.
- **Editor preview:** the same package's **browser WASM** (`rehype-d2-browser.mjs`).
- **Why D2 over Mermaid:** prettier + more capable, and — decisively — it renders **without a
  headless browser**, so the build no longer needs `npx playwright install chromium`.
- **Caveat:** `@terrastruct/d2` is pinned pre-1.0. Dev-server quirk: adding the dep can wedge
  the Vite optimizer → restart `npm run dev` (production unaffected).

---

## 8. Environment & dev workflow

Prereqs: **Node ≥ 22.12**, npm, git. Windows-friendly (built on Windows).

Development uses **three surfaces** (iterating directly on production is painful — hashed
chunk names change and the custom domain briefly serves a stale chunk):

| Surface | Command / trigger | URL |
| --- | --- | --- |
| **Local** | `npm run dev` | http://localhost:4321 — primary iteration + testing (HMR, no deploy, no cache) |
| **Preview** | `npm run deploy:preview` (Wrangler) **or** push `dev` (Git-integration) | `preview.areyoustillreading.pages.dev` + a fresh unique `<hash>.pages.dev` per deploy (use the unique URL to dodge alias cache lag) |
| **Production** | `npm run deploy` (Wrangler) **or** merge/push `main` | https://areyoustillreading.dev — intentional releases only |

Git branches: ongoing work on **`dev`**; **`main`** tracks production. Promote by merging
`dev` → `main`. Git author is `shivam7569`; **Claude co-authorship stays disabled.**

```bash
npm install
npm run dev            # local dev server
npm run build          # astro build + pagefind → dist/  (NO Chromium needed)
npm run preview        # serve the production build locally
npm test               # builds, then Vitest assertions on dist/
npm run deploy         # build + wrangler pages deploy dist  (production)
npm run deploy:preview # build + wrangler pages deploy dist --branch=preview
```

> Deploy gotchas (learned): Astro 308-redirects `/x`→`/x/` (poll with `curl -L`); a CF
> git-build can fail at asset upload with a transient `521` (retry via the Wrangler direct
> upload); the production alias lags ~1 min after a Wrangler deploy — poll the apex for the
> new hashed `_astro/*.[hash].{css,js}` bundle before declaring "live".

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
| `RESEND_API_KEY` | subscribe, broadcast | Resend API key (also Supabase SMTP password) |
| `EMAIL_FROM` *(opt)* | subscribe, broadcast | sender address (default `hello@areyoustillreading.dev`) |
| `MAIL_ADDRESS` | broadcast | physical mailing address for the newsletter footer (CAN-SPAM); set before real sends |
| `TURNSTILE_SECRET_KEY` | subscribe | Turnstile secret (server-side verify) |
| `DODO_API_KEY` | checkout | Dodo API key (test or live) |
| `DODO_WEBHOOK_SECRET` | dodo-webhook | Dodo webhook signing secret |
| `DODO_API_BASE` *(opt)* | checkout | default `https://test.dodopayments.com`; live = `https://dodopayments.com` |
| **`DODO_UNLOCK_PRODUCT_ID`** | checkout | the **single reusable Pay-What-You-Want product** charged each post's price |
| **`GITHUB_TOKEN`** | publish + admin | fine-grained PAT, **Contents: write** on the repo |
| `GITHUB_REPO` *(opt)* | publish + admin | `owner/name` (default `shivam7569/areyoustillreading`) |
| `GITHUB_BRANCH` *(opt)* | publish + admin | commit target (default `main`; set `dev` on Preview env to test safely) |
| `SITE_URL` *(opt)* | broadcast | absolute base for links in emails |

Also: a **KV namespace** binding (rate-limiting + the instant-publish post cache). Supabase
needs **custom SMTP** (Authentication → SMTP) via Resend (`smtp.resend.com:465`, user
`resend`, password = a Resend API key) so auth emails send from `hello@areyoustillreading.dev`.

> There is **no `PUBLISH_SECRET`** — publish/admin auth is the author's normal Supabase admin
> session, verified server-side.

---

## 10. Cloudflare Functions reference

| Route | Method | Purpose | Key env |
| --- | --- | --- | --- |
| `/api/subscribe` | POST | Double-opt-in: Turnstile → honeypot → insert pending → Resend confirm. No enumeration; rate-limited. | SUPABASE_*, RESEND_API_KEY, TURNSTILE_SECRET_KEY |
| `/api/confirm?token=` | GET | Confirm a subscription (idempotent). | SUPABASE_* |
| `/api/unsubscribe?token=` | GET | One-click unsubscribe. | SUPABASE_* |
| `/api/track` | POST | Cookieless analytics beacon → insert an `analytics_events` row. Rate-limited; `?noanalytics=1` opts out client-side. | SUPABASE_* |
| `/api/checkout` | POST | Verify user token → read the post's `price_cents` → create a hosted **Pay-What-You-Want** checkout on `DODO_UNLOCK_PRODUCT_ID` for that amount, `metadata {post_id,user_id}` → return `{url}`. | SUPABASE_*, DODO_API_KEY, DODO_UNLOCK_PRODUCT_ID |
| `/api/dodo-webhook` | POST | Verify Standard-Webhooks signature → on `payment.succeeded`, upsert an `entitlements` row. | DODO_WEBHOOK_SECRET, SUPABASE_* |
| **`/api/publish`** | POST | **Verify admin session** → commit `src/content/blog/<slug>.md` to GitHub; optional newsletter broadcast. | GITHUB_TOKEN, SUPABASE_*, RESEND_API_KEY |
| `/api/admin/post` | POST | Admin — edit a post's frontmatter (visibility, paywall, series, early access) → commit. | GITHUB_TOKEN, SUPABASE_* |
| `/api/admin/{resume,projects,site}` | GET/POST | Admin — read + commit `src/data/{resume,projects,site}.json` (projects/resume also handle image/PDF assets). | GITHUB_TOKEN, SUPABASE_* |
| `/api/admin/{overview,posts,subscribers,analytics,sales,comments}` | GET | Admin dashboards — read aggregates for the Studio. | SUPABASE_* |
| `/api/admin/{broadcast,digest,early}` | POST | Admin — send the newsletter broadcast / a digest / manage early access. | RESEND_API_KEY, MAIL_ADDRESS, SUPABASE_* |
| `/blog/*` | middleware | Instant-publish: overlay a just-committed post into the archive/post page until the rebuild lands (from KV). | (KV) |
| `/gated/*` | middleware | Gate full-content fragments: not paywalled → serve; else require a valid Supabase token AND (admin OR entitlement), else **403**. Fails safe (locked). | SUPABASE_* |

### Paywall architecture (the important one)

- A post is monetizable only if authored with `gateable: true`. Such posts render **only the
  preview** on `/blog/<slug>` (`<PaywallGate>`); the **full body is never in static HTML, RSS,
  sitemap, or search** (verified by `tests/paywall.test.ts`).
- The full body is a bare fragment at `/gated/<slug>`, gated by `functions/gated/_middleware.js`;
  the browser fetches it with the reader's Supabase JWT.
- **Price-only Pay-What-You-Want:** there is **no per-post Dodo product**. The admin sets a
  per-post **price** (`post_paywall.price_cents`, via `PaywallGate.astro`'s admin toggle); at
  checkout a **single reusable PWYW product** (`DODO_UNLOCK_PRODUCT_ID`) is charged that
  amount. A post that was ever fully public can't be retroactively locked — that's why
  monetizable posts are preview-only from day one.
- Purchase: **Unlock** → `/api/checkout` → Dodo checkout → pay → **webhook** →
  `/api/dodo-webhook` writes the entitlement → the gate serves the body.

---

## 11. Data model (Supabase) & setup order

RLS is enabled on **every** table. Run each file once in the Supabase **SQL editor**, in
order (later files reuse `is_admin()`):

1. `db/schema.sql` — **subscribers** (+ confirm/unsubscribe tokens, early-access). RLS on, no policies → only service-role Functions touch it.
2. `db/comments.sql` + `db/comments-threads.sql` — **comments** (public read; own insert/delete) + threading.
3. `db/highlights.sql` + `db/highlights-notes.sql` — **admins** (`insert into public.admins …`), `is_admin()` (plpgsql, security-definer), **highlights** + **highlight_comments**.
4. `db/notes.sql` — **notes** (one per post per reader; own-or-admin).
5. `db/votes.sql` — **votes** on comments/highlights (own; aggregate read).
6. `db/entitlements.sql` — **entitlements** `(user_id, post_id)`. Select own only; only the webhook writes.
7. `db/post_paywall.sql` — **post_paywall** `(post_id, is_paid, price_cents, currency, product_id)` — price is the source of truth (product is the shared PWYW one).
8. `db/analytics.sql` — **analytics_events** (cookieless pageview/event rows) + a retention/purge routine; synthetic load-test rows tagged `lt_`.
9. `db/drafts.sql` — **drafts** (per-user server-side editor drafts; own-or-admin).

> `is_admin()` is deliberately **`language plpgsql`** — a `language sql` version fails to
> create in the Supabase editor. **Your Supabase user must be in `public.admins`** to reach
> the Studio and publish.

---

## 12. Testing

`npm test` runs Vitest. `tests/global-setup.ts` runs `npm run build` once (a green build is
itself the first gate), then each `tests/*.test.ts` asserts on the emitted `dist/` — pages
exist, markup markers present, feeds/sitemap correct, data-driven pages render their content,
and crucially **paid bodies never leak** into public output. Nothing advances until `npm test`
is green. Current: **43 tests / 22 files.**

---

## 13. Deployment

- **Cloudflare Pages Git-integration** (primary): production branch `main`, build command
  `npm run build`, output `dist/`. A push (or a `/api/publish` / `/api/admin/*` commit) to
  `main` → production build; a push to `dev` → preview build. **No Chromium in the build.**
- **Wrangler direct upload** (also available): `npm run deploy` (production) / `npm run
  deploy:preview` (preview) build locally and upload `dist/`. Env vars set in the Pages
  project apply to both deploy paths.
- Custom domain `areyoustillreading.dev` is attached in the Pages dashboard.

### Going live on payments (from test mode)

1. Create the **live** reusable **Pay-What-You-Want** product in Dodo → set
   `DODO_UNLOCK_PRODUCT_ID` (live). Set each paid post's **price** via the admin toggle.
2. Set `DODO_API_KEY` (live) and `DODO_API_BASE = https://dodopayments.com`.
3. Create a **live** Dodo webhook → `https://areyoustillreading.dev/api/dodo-webhook`
   (`payment.succeeded`) → set `DODO_WEBHOOK_SECRET`.

### Pre-launch checklist

- Remove any demo/test posts and set the real newsletter `MAIL_ADDRESS`.
- Flip Dodo from test → live keys (above).

---

## 14. Security notes

- **RLS on every table.** The browser only holds the anon key + the user's JWT; the
  service-role key exists only inside Functions.
- **The Studio is double-gated:** a client gate (`admin-gate.ts`) reveals the UI only for a
  confirmed admin, and **every `/api/admin/*` endpoint independently re-checks** the admin
  session server-side — link visibility is never the boundary.
- **Paywall is server-side** and fails safe (locked). **`/api/publish` + `/api/admin/*`** hold
  repo-write access and are gated by a verified admin Supabase session.
- **Webhook** signatures are HMAC-verified before writing entitlements. **Subscribe** has a
  honeypot, per-email cooldown, no-enumeration responses, and Turnstile. Public endpoints are
  **rate-limited** (KV).
- **CSP is ENFORCING** (`public/_headers`) — a new CDN host must be added there or it's
  blocked. Analytics is **first-party + cookieless** (no third-party script).
- **Secrets** never enter the repo. Security headers ship via `public/_headers`.
- **Never auto-post to socials** — sharing is the manual `ShareBar` (web-intent links) only.

---

## 15. Gotchas learned (so you don't rediscover them)

- Astro 7's default Markdown processor ignores remark/rehype plugins → install
  **`@astrojs/markdown-remark`**.
- `_`-prefixed folders under `src/pages/` are **not routed** → gated route is `src/pages/gated/…`
  with the middleware at `functions/gated/_middleware.js`.
- Resend refuses to send until the **domain is verified** ("added" ≠ "verified").
- `is_admin()` must be **plpgsql**.
- **Astro scoped `<style>` does NOT reach innerHTML-injected DOM** → the Studio pages use a
  `.<name>studio`-prefixed `<style is:global>`; and Astro appends a scope hash to class lists,
  so test assertions use data-attributes, not class substrings.
- **`{expr}` output HTML-escapes apostrophes to `&#39;`** — renders identically; don't be
  alarmed grepping built HTML.
- **D2 (`@terrastruct/d2`) Node build runs on a worker_thread** — terminate it after use or
  `astro build` hangs (handled in `plugins/rehype-d2.mjs`).
- **Pyodide/Plotly** are lazy-loaded and run **only in the editor**; concurrent plot cells must
  be **serialized** through the one interpreter. Reader plots are baked figure JSON.
- **`onAuthStateChange` fires `SIGNED_IN` on every load + tab refocus** — never reload on it.
- Deploy: follow `/x`→`/x/` redirects when polling; a CF `521` at asset upload is transient
  (retry via Wrangler direct upload); the production alias lags ~1 min.
- Complex shell one-liners (`$(...)` capture, `;`-chains) can trigger permission prompts →
  prefer plain single commands.

---

## 16. Roadmap

- **Phase 1 — Free site + owned subscribe.** ✅ live.
- **Phase 2 — Auth + engagement (comments, highlights + discussion, private notes).** ✅
- **Phase 3 — Per-post paywall (Dodo MoR, price-only PWYW).** ✅ (test mode; flip to live per §13).
- **Phase 4 — Writing Studio.** ✅ WYSIWYG editor, D2 diagrams, interactive Python/Plotly
  cells + GIF export + notebook output, **reader-side interactive plots** ✅, server-side
  drafts ✅, premium publish modal + `/api/publish` ✅, **full admin dashboard** ✅
  (posts / drafts / audience / engagement / analytics / revenue), **newsletter broadcast on
  publish** ✅, **first-party analytics** ✅, **data-driven resume + projects with Studio
  editors** ✅, **series** ✅.
- **Phase 5 — UI/UX design refinement + Content Management.** ✅ the Editorial design system
  across the whole site; ✅ **Content Management** makes every page's copy editable from the
  Studio (16 of the site's surfaces done; the shared reader widgets — subscribe form, share
  bar, series nav, paywall band, comments/notes/highlights — are the remaining batch).
- **Pre-launch backlog:** remove test posts; flip Dodo test → live keys.
