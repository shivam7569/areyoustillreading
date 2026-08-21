# Launch runbook

Go-live checklist for promoting areyoustillreading from the `dev` preview to production.
Everything below is a **launch-time action** — deliberately NOT done during development
(load-test data is kept until launch; the OG/sitemap caps are coupled to that purge).

Run the steps **in order**.

## 1. Apply the database schema to the production Supabase

There is no formal migration tracker — **the `dev` database is the reference**: production must
end up with the same `content.*` schema, RLS, and public RPCs that `dev` has. Apply the `db/*.sql`
files with `node --env-file=.env.prod scripts/apply-sql.mjs db/<file>` (a prod `DATABASE_URL`).

Order that matters: **`content.sql` first** (the schema + roles + RLS + base RPCs), then
**`content-collab.sql`** (supersedes some base single-author policies). Everything else is
additive public SECURITY-DEFINER RPCs and can be applied after, in any order. After creating
public RPCs run `notify pgrst, 'reload schema';` (each file ends with it) or the first REST call
404s (PGRST202). On any `RETURNS TABLE` change, `drop function` first (the files already do).

- **Skip the paywall/monetization migrations** (`post_paywall.sql`, `entitlements.sql`,
  `votes.sql` if unused) — the paywall is dropped from the critical path.
- `db/reset-data.sql` is a local scratch helper — **do not apply to prod**.

## 2. Set production environment variables / bindings

Cloudflare Pages → Settings → Bindings (Production), and GitHub Actions secrets.

**Required (core platform):**
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PUBLIC_SUPABASE_ANON_KEY`, `POSTS_HTML` (KV
namespace binding), `SITE_URL`.

**Newsletter + forms:** `RESEND_API_KEY`, `EMAIL_FROM`, `MAIL_ADDRESS`, `TURNSTILE_SECRET_KEY`.

**Author notifications:** `AUTHOR_EMAIL`, `NOTIFY_SECRET`.

**Scheduled-publish cron (GitHub Actions secrets):** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
(the `.github/workflows/scheduled-publish.yml` flip job; ensure Actions are enabled with
`permissions: contents: write`).

**Not needed** unless the dormant paywall / file-publish paths are revived: `DODO_*`,
`GITHUB_TOKEN`/`GITHUB_REPO`/`GITHUB_BRANCH`.

## 3. Fonts — already handled

`public/fonts/` ships **Source Serif 4** (display) and **Charis SIL** (body), both under the SIL
Open Font License (`SourceSerif4-LICENSE.txt`, `CharisSIL-LICENSE.txt`). No commercial license to
clear; nothing to do. (`global.css` `--serif-display` / `--serif-body`.)

## 4. Purge the load-test data

```bash
npm run loadtest:teardown
```

Removes the ~1000 `lt-*` posts and the `@loadtest.invalid` authors/readers + their analytics.
Run this only at launch — it is intentionally kept during development for volume testing.

## 5. Raise the OG-card + sitemap caps (AFTER the purge)

`src/pages/og/[...route].ts` currently caps per-post OG cards at the ~50 most recent
(`list_feed_posts`), and the DB sitemap lists whatever is published. With the load-test data
gone, raise the OG cap to cover the full (now real) catalogue. **Do this after step 4** so the
build doesn't generate ~1000 load-test cards. (Small code change — ask Claude to make it once the
data is clean.)

## 6. Deploy + verify

```bash
npm run deploy
```

Then verify: the homepage feed, a `/@handle/slug` post (renders + islands + per-request CSP
nonce), `/rss.xml`, `/sitemap-posts.xml`, a subscribe → confirm round-trip, and one author
publish end-to-end.

## Deferred (not required for launch)
- **Phase 4 pillars** — cookieless sandbox origin + authoritative server-side re-render (need
  infrastructure; see the security notes).
- **`BlogPost.astro` + `blog/[...slug].astro`** — dead file-post code (empty content collection →
  zero pages), entangled with the paywall/gated/KV-overlay machinery; left in place deliberately.
