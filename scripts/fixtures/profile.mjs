/**
 * scripts/fixtures/profile.mjs — WHICH SLICE of the fixture blueprint to seed.
 * ============================================================================
 * plan.mjs is the FULL, dense dataset: every feature and every edge. That is the
 * right thing to seed when you are testing coverage — but 22 published posts is far
 * too much to eyeball when you are checking a layout, a hover state, or a feed row.
 *
 * So the seed runs LEAN by default (a small feed) and the dense set is one flag away:
 *
 *     npm run fixtures:reseed            → lean
 *     npm run fixtures:reseed:full       → full  (every post, every edge)
 *     npm run fixtures:reseed -- --full  → same as :full
 *     FIXTURES=full node scripts/fixtures/seed.mjs
 *
 * WHAT LEAN KEEPS. One post per feed-row state worth looking at. With a single author
 * every byline is the same, so what varies is the REST of the row: a series crumb with
 * real parts, an empty-description row, and heavy/medium/light engagement so the
 * retention curves — and therefore the hover tooltips — still differ. Two posts sit
 * inside the fortnight window and several are older, so the homepage exercises BOTH
 * bands (this-fortnight and the most-read fallback).
 *
 * WHAT LEAN NEVER DROPS. The hidden-state posts (draft / scheduled / unlisted): none of
 * them appear in a feed, so they cost nothing to eyeball while keeping those edges seeded.
 *
 * Series and fields are DERIVED from the surviving posts, never hand-listed, so the
 * seed can't produce a post pointing at a missing series or a field rendering an empty page.
 */
import * as plan from './plan.mjs';

export const PROFILE =
  process.argv.includes('--full') || process.env.FIXTURES === 'full' ? 'full' : 'lean';
const lean = PROFILE === 'lean';

// The lean feed — one post per row-state worth looking at.
const LEAN_FEED = new Set([
  'every-knob',              // the kitchen-sink renderer post (heavy, recent)
  'retrieval-meets-serving', // a standalone essay across two subjects (heavy, recent)
  'sas-1',                   // part 1 of 5 — series crumb + part ticks (medium)
  'sas-2',                   // part 2 of 5 — gives that series a real run (medium)
  'no-description',          // the empty-description row (light)
  // Two more in-progress series, so the "Coming next" shelf has more than one card.
  // (embeddings-from-scratch is status:complete, so it is excluded from that shelf by design.)
  'rp-1',                    // part 1 of 3 — Retrieval plumbing, in progress
  'mm-1',                    // part 1 of 4 — Measuring models, in progress
  'mm-2',                    // part 2 of 4 — 2 published is what its planned[] assumes
  // The 'Measuring models' card needs a field eyebrow, and its field
  // (making-models-measurable) only seeds once BOTH its series survive — so bring in
  // embeddings-from-scratch. All 3 parts, because that series is status:complete and
  // seeding 1 of 3 would render a 'complete' series that plainly isn't.
  'efs-1',                   // part 1 of 3 — Embeddings from scratch (complete)
  'efs-2',                   // part 2 of 3
  'efs-3',                   // part 3 of 3
]);
// Never visible in a feed → keep in BOTH profiles so these edges stay covered for free.
const ALWAYS = new Set([
  'work-in-progress', // draft
  'coming-next-week', // scheduled
  'retired-thoughts', // unlisted
]);

export const DOMAIN = plan.DOMAIN;

// One author, always — there is no roster to slice.
export const AUTHORS = plan.AUTHORS;

export const POSTS = lean
  ? plan.POSTS.filter((p) => LEAN_FEED.has(p.slug) || ALWAYS.has(p.slug))
  : plan.POSTS;

// 6, not fewer: engagement needs >= 4 distinct readers for a "popular passage"
// (ENGAGE.heavy.popularReaders = 4), and the unique-highlight stride of 5 in seed.mjs
// collapses onto one reader unless the pool size is coprime with it.
export const READERS = lean ? plan.READERS.slice(0, 6) : plan.READERS;

export const SUBSCRIBERS = lean ? { confirmed: 4, pending: 1, unsubscribed: 1 } : plan.SUBSCRIBERS;

// ── Derived, so a filtered plan can never seed a broken relationship ─────────
const keptSeries = new Set(POSTS.filter((p) => p.series).map((p) => p.series[0]));
export const SERIES = lean ? plan.SERIES.filter((s) => keptSeries.has(s.slug)) : plan.SERIES;

// A field is only public once it gathers >= 2 series, so only seed one whose series all survived.
export const FIELDS = lean
  ? plan.FIELDS.filter((f) => f.series.length >= 2 && f.series.every((s) => keptSeries.has(s)))
  : plan.FIELDS;
