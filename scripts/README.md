# Content scripts (Phase 1 — multi-author rearchitecture)

Server-side dev/ops tooling for the new `content.*` schema. **Run locally against your
dev database only.** Phase 1 keeps `content` *unexposed* to PostgREST (shadow posture),
so these scripts talk to Postgres directly (`pg`) and use the Supabase Auth admin API
only to mint/remove dummy users.

## Setup

1. **Apply the schema.** Paste `db/content.sql` into the Supabase SQL editor and run it.
   It's idempotent and **self-verifies** — the final block RAISEs if the privilege
   lockdown ever drifts. You should see `VERIFY OK` in the notices.

2. **Install deps** (adds `pg`):
   ```bash
   npm install
   ```

3. **Set env** — create a local `.env` at the repo root (git-ignored; do **not** commit):
   ```
   DATABASE_URL=postgresql://postgres:<pwd>@<host>:5432/postgres   # Supabase → Settings → Database → Connection string
   SUPABASE_URL=https://<ref>.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=<service-role key>                    # never ship to a client
   # LOADTEST_PASSWORD=optional-override
   ```

## Phase-1 gate (backfill your real content, then prove nothing changed)

```bash
npm run backfill          # shadow-load existing posts/series/fields into content.*
npm run verify:content    # (a) lossless (b) render-identical  → must PASS
```
Then confirm the site itself is untouched:
```bash
git diff --stat origin/main -- src functions astro.config.mjs public   # expect: no output
```

## Load testing

Dummy authors + readers (real `auth.users`, tagged `@loadtest.invalid`) and bulk content
(tagged `lt-`). Content is bulk-inserted over `pg`, so you can push post volume high
without thousands of auth calls.

```bash
npm run loadtest:seed -- --authors 10 --readers 40 --posts-per-author 50
npm run loadtest:probe -- --runs 60      # p50/p95/max on the feed, author, tag, join, search queries
npm run loadtest:teardown                # removes every lt- / @loadtest.invalid artifact
```

`probe` measures raw query/index latency (owner connection, RLS bypassed). The RLS-path
load test — signing in as dummy authors and hitting PostgREST — lands in **Phase 2**, once
`content` is exposed to the API.

## Files
- `_shared.mjs` — env loading, `pg` pool, Supabase admin client, owner resolution, helpers.
- `backfill-content.mjs` — Markdown + series.json + fields.json → `content.*` (idempotent).
- `verify-content-bytediff.mjs` — the acceptance gate (lossless + render-identical).
- `loadtest/seed.mjs` · `loadtest/probe.mjs` · `loadtest/teardown.mjs`.
