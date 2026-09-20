-- =============================================================================
-- db/reading-pairs-llm.sql — storage + candidate generation for "Read them together".
--
-- WHY THIS EXISTS. The original public.reading_pairs() decided a pair from ONE shared
-- tag and the primary author id. That is too weak for the claim the section makes: a
-- housekeeping tag like "meta" pairs unrelated essays, and because it compares
-- posts.author_id (the DENORMALIZED primary author) rather than the real author set in
-- content.post_authors, it produced pairs with the same human on BOTH sides.
--
-- The new shape splits the job in two:
--   RULES (here)  decide ELIGIBILITY — cheap, exact, and the only thing allowed to make
--                 a correctness claim: published, public, dated, live authors, and two
--                 genuinely DISJOINT author sets.
--   A JUDGE (app) decides RELATEDNESS — whether two eligible essays actually reach the
--                 same subject, and why. Judged once and stored; never on a page load.
--
-- Nothing here calls a model. This file only creates the table the judge writes to and
-- the candidate list it reads from, so it is safe to apply before any key exists.
-- The live public.reading_pairs() is deliberately NOT touched yet — the section keeps
-- working off the old logic until the table has content to serve.
--
-- Idempotent. Apply: node --env-file=.env scripts/apply-sql.mjs db/reading-pairs-llm.sql
-- =============================================================================

-- ── judged pairs ────────────────────────────────────────────────────────────
-- One row per unordered pair. a_id < b_id is enforced so (A,B) and (B,A) can never
-- both exist — a pair has no direction. Reading ORDER is chronological and is decided
-- at render time from pub_date, not stored here.
create table if not exists content.reading_pairs (
  a_id           uuid        not null references content.posts(id) on delete cascade,
  b_id           uuid        not null references content.posts(id) on delete cascade,
  related        boolean     not null,              -- the judge's verdict; false = keep the NO
  score          numeric(4,3) not null default 0,   -- 0..1 confidence, for ranking
  subject        text,                              -- what they share, in reader language
  reason         text,                              -- one honest line; shown on the card
  model          text        not null,              -- which model judged it
  prompt_version int         not null default 1,    -- bump to invalidate old verdicts
  approved       boolean     not null default true, -- flip default to false to gate behind review
  judged_at      timestamptz not null default now(),
  primary key (a_id, b_id),
  constraint reading_pairs_ordered check (a_id < b_id),
  constraint reading_pairs_score   check (score >= 0 and score <= 1)
);

-- The read path only ever wants winners, best first.
create index if not exists reading_pairs_best_idx
  on content.reading_pairs (score desc)
  where related and approved;

-- ── eligibility ─────────────────────────────────────────────────────────────
-- A post may take part at all. Kept as a view so the candidate query and any future
-- backfill share ONE definition and cannot drift apart.
create or replace view content.pairable_posts as
  select po.id, po.slug, po.title, po.description, po.pub_date, po.reading_min, po.tags,
         (select array_agg(pa.user_id order by pa.position)
            from content.post_authors pa where pa.post_id = po.id and pa.accepted) as author_ids,
         (select array_agg(coalesce(pr.pen_name, pr.handle::text) order by pa.position)
            from content.post_authors pa join content.profiles pr on pr.id = pa.user_id
           where pa.post_id = po.id and pa.accepted) as author_names,
         (select pr.handle from content.profiles pr where pr.id = po.author_id) as primary_handle
  from content.posts po
  where po.status = 'published'
    and po.visibility = 'public'
    and po.deleted_at is null
    -- pub_date is nullable; without this an undated post sorts FIRST on a DESC order and
    -- would render as "January 1970" on the card. Future-dated posts are not out yet.
    and po.pub_date is not null
    and po.pub_date <= now()
    -- every ACCEPTED author must be live: a suspended or deleted author must not appear
    -- in the most endorsing slot on /blog, and a null handle would emit /@null links.
    and not exists (
      select 1 from content.post_authors pa
      join content.profiles pr on pr.id = pa.user_id
      where pa.post_id = po.id and pa.accepted
        and (pr.status <> 'active' or pr.deleted_at is not null or pr.handle is null)
    )
    and exists (select 1 from content.post_authors pa where pa.post_id = po.id and pa.accepted);

-- ── candidates ──────────────────────────────────────────────────────────────
-- Eligible, not-yet-judged pairs for the judge to work through.
--   p_anchor  NULL  → every pair (the one-time backfill; fine at this size)
--             a uuid → only that post against the rest (what a publish triggers)
-- The author-set overlap test (&&) is the fix for the old author_id bug: two posts that
-- share ANY accepted author are the same people, not two people, and are never a pair.
drop function if exists content.reading_pair_candidates(uuid, int);
create or replace function content.reading_pair_candidates(p_anchor uuid default null, p_limit int default 500)
returns table (
  a_id uuid, b_id uuid,
  a jsonb, b jsonb
)
language sql stable security definer set search_path = content, public, extensions as $$
  select
    least(x.id, y.id) as a_id,
    greatest(x.id, y.id) as b_id,
    to_jsonb(case when x.id < y.id then x else y end) - 'author_ids' as a,
    to_jsonb(case when x.id < y.id then y else x end) - 'author_ids' as b
  from content.pairable_posts x
  join content.pairable_posts y
    on x.id < y.id
   and not (x.author_ids && y.author_ids)   -- disjoint author SETS, not primary ids
  where (p_anchor is null or x.id = p_anchor or y.id = p_anchor)
    and not exists (
      select 1 from content.reading_pairs rp
      where rp.a_id = least(x.id, y.id) and rp.b_id = greatest(x.id, y.id)
    )
  limit p_limit;
$$;

-- VERIFY (optional):
--   select count(*) from content.pairable_posts;
--   select count(*) from content.reading_pair_candidates();
