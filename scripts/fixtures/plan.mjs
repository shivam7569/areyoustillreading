/**
 * scripts/fixtures/plan.mjs — the fixture BLUEPRINT.
 * ============================================================================
 * One dense, realistic, edge-case-covering dataset that exercises EVERY feature.
 * The body markdown for each post lives in scripts/fixtures/posts/<slug>.md
 * (committed, so the seed is reproducible). This file defines everything that ties
 * together; scripts/fixtures/seed.mjs turns it into DB rows.
 *
 * SINGLE AUTHOR. The site has exactly one writer — the owner — and everyone else can
 * only read. So there are no other author profiles, no co-authored posts, no invites
 * or membership proposals, and no suspension/onboarding edges: those all needed a
 * second person to mean anything. Every series, field and post below belongs to the
 * owner, which is also what makes a post slug unique site-wide.
 *
 * Tagging (so scripts/fixtures/reset.mjs can always start clean): fixture readers use
 * @seed.invalid emails; the owner is the real site owner and is REUSED, never recreated.
 */

export const DOMAIN = 'seed.invalid';

// ── Author ───────────────────────────────────────────────────────────────────
// Exactly one, and it is the real owner row (reuseOwner), so the seed never invents a
// second writer. Kept as an array because seed.mjs iterates it and the downstream code
// still expects a byline list — it is simply always a list of one.
export const AUTHORS = [
  { key: 'owner', reuseOwner: true, handle: 'gradghost', pen: 'Shivam Prakash', role: 'author',
    bio: 'I write about the systems under machine learning — retrieval, inference, and the plumbing that decides whether any of it holds up in production.',
    avatar: null, colophon: 'Written in plain text, rendered at the edge. Diagrams in D2, plots in Plotly, math in KaTeX. No trackers.' },
];

// ── Readers (attribute engagement to real auth.users) ────────────────────────
// Readers are the ONLY other people on the site. They keep their full surface:
// comments, highlights, notes, votes, feedback and reading progress.
export const READERS = [
  'Ada Lovelace', 'Grace Hopper', 'Alan Kay', 'Barbara Liskov', 'Ken Thompson', 'Radia Perlman',
  'Leslie Lamport', 'Margaret Hamilton', 'Vint Cerf', 'Karen Spärck Jones', 'Jim Gray', 'Fran Allen',
  'Tim Berners-Lee', 'Shafi Goldwasser', 'John Carmack', 'Cynthia Dwork',
];

// ── Series ───────────────────────────────────────────────────────────────────
// status: in-progress | complete ; total = declared part count (may exceed published,
// which is what renders the "planned / soon" parts). The four below deliberately differ:
// one has a long publishing GAP mid-run, one is complete, and two are still running.
export const SERIES = [
  { slug: 'serving-at-speed', owner: 'owner', title: 'Serving at speed', total: 5, status: 'in-progress',
    summary: 'Everything between a trained model and a fast, boring, reliable endpoint.' },
  { slug: 'embeddings-from-scratch', owner: 'owner', title: 'Embeddings from scratch', total: 3, status: 'complete',
    summary: 'Building an embedding stack from the data up, and measuring it honestly.' },
  { slug: 'measuring-models', owner: 'owner', title: 'Measuring models', total: 4, status: 'in-progress',
    summary: 'Evaluation that survives contact with a real system.' },
  { slug: 'retrieval-plumbing', owner: 'owner', title: 'Retrieval plumbing', total: 3, status: 'in-progress',
    summary: 'The unglamorous pipes between a query and the right chunk.' },
];

// ── Fields (public once they gather >=2 series) ──────────────────────────────
// mark = one of the 10 generative field marks ('01'..'10'). Two fields x two series each
// is the minimum that proves the >=2 rule both ways: each field qualifies, and neither
// would if a single series were dropped.
export const FIELDS = [
  { slug: 'systems-for-inference', owner: 'owner', title: 'Systems for inference', mark: '03',
    summary: 'The engineering around a model, not the model.', series: ['serving-at-speed', 'retrieval-plumbing'] },
  { slug: 'making-models-measurable', owner: 'owner', title: 'Making models measurable', mark: '07',
    summary: 'Turning "it feels better" into a number you can defend.', series: ['measuring-models', 'embeddings-from-scratch'] },
];

// ── Posts ────────────────────────────────────────────────────────────────────
// pubDaysAgo: negative/scheduled handled by status. series:[slug,part].
// bodySpec.features drives what the generated markdown must contain.
const P = (o) => o;
export const POSTS = [
  // Kitchen sink — every renderer in one post. Recent, heavily engaged.
  P({ slug: 'every-knob', author: 'owner', title: 'Every knob we ship: one post, one stress test',
    description: 'A single essay that exercises the whole rendering stack — code, math, diagrams, an interactive plot, tables, and the reader tools around it.',
    tags: ['systems', 'meta', 'retrieval'], pubDaysAgo: 3, engage: 'heavy',
    bodySpec: { len: 'long', features: ['dropcap', 'headings', 'code:python', 'code:rust', 'code:sql', 'math-inline', 'math-display', 'd2', 'plotly', 'table', 'blockquote', 'image', 'mnote', 'lists'] } }),

  // Per-renderer focus posts.
  P({ slug: 'a-tour-of-retrieval', author: 'owner', title: 'A tour of the retrieval stack',
    description: 'What actually happens between a query and an answer, drawn out.', tags: ['retrieval', 'systems'],
    pubDaysAgo: 6, engage: 'medium', bodySpec: { len: 'medium', features: ['headings', 'd2', 'd2-sequence', 'blockquote', 'lists'] } }),
  P({ slug: 'the-math-of-attention', author: 'owner', title: 'The math of attention, slowly',
    description: 'Attention with every step written out, for people who bounce off the hand-waving.', tags: ['eval', 'meta'],
    pubDaysAgo: 10, engage: 'medium', bodySpec: { len: 'medium', features: ['headings', 'math-inline', 'math-display', 'lists', 'code:python'] } }),
  P({ slug: 'latency-visualized', author: 'owner', title: 'Latency, visualized',
    description: 'Three plots that changed how I think about tail latency.', tags: ['serving', 'latency'],
    pubDaysAgo: 8, engage: 'heavy', bodySpec: { len: 'medium', features: ['headings', 'plotly', 'plotly-3d', 'table', 'code:python'] } }),
  P({ slug: 'a-note-on-tokenizers', author: 'owner', title: 'A short note on tokenizers',
    description: 'Two paragraphs I wish someone had handed me.', tags: ['meta'], pubDaysAgo: 1, engage: 'light',
    bodySpec: { len: 'short', features: ['headings', 'code:python'] } }),

  // Series: "Serving at speed" — 5 parts, IRREGULAR cadence (a gap) for "The Gap".
  P({ slug: 'sas-1', author: 'owner', title: 'Serving at speed, part one: the shape of the problem',
    description: 'Where the milliseconds actually go.', tags: ['serving', 'latency', 'systems'], series: ['serving-at-speed', 1],
    pubDaysAgo: 90, engage: 'medium', bodySpec: { len: 'medium', features: ['headings', 'd2', 'code:python', 'lists'] } }),
  P({ slug: 'sas-2', author: 'owner', title: 'Serving at speed, part two: batching is a scheduling problem',
    description: 'The scheduler you did not know you were writing.', tags: ['serving', 'latency'], series: ['serving-at-speed', 2],
    pubDaysAgo: 76, engage: 'medium', bodySpec: { len: 'medium', features: ['headings', 'd2', 'math-inline', 'code:rust'] } }),
  P({ slug: 'sas-3', author: 'owner', title: 'Serving at speed, part three: the KV cache is memory pressure',
    description: 'Why your throughput cliff is a memory cliff.', tags: ['serving', 'systems'], series: ['serving-at-speed', 3],
    pubDaysAgo: 70, engage: 'heavy', bodySpec: { len: 'long', features: ['headings', 'plotly', 'table', 'code:python', 'math-display'] } }),
  // ...then a long gap...
  P({ slug: 'sas-4', author: 'owner', title: 'Serving at speed, part four: speculative decoding, honestly',
    description: 'The wins, and the three times it made things worse.', tags: ['serving', 'latency'], series: ['serving-at-speed', 4],
    pubDaysAgo: 12, engage: 'medium', bodySpec: { len: 'medium', features: ['headings', 'd2', 'code:python', 'blockquote'] } }),
  P({ slug: 'sas-5', author: 'owner', title: 'Serving at speed, part five: the boring endpoint',
    description: 'What "done" looks like.', tags: ['serving'], series: ['serving-at-speed', 5], pubDaysAgo: 4, engage: 'light',
    bodySpec: { len: 'short', features: ['headings', 'lists', 'blockquote'] } }),

  // Series: "Embeddings from scratch" — 3 parts, COMPLETE, steady cadence.
  P({ slug: 'efs-1', author: 'owner', title: 'Embeddings from scratch, part one: the data decides',
    description: 'Every embedding failure I have seen started upstream.', tags: ['embeddings', 'eval'], series: ['embeddings-from-scratch', 1],
    pubDaysAgo: 55, engage: 'medium', bodySpec: { len: 'medium', features: ['headings', 'table', 'code:python', 'lists'] } }),
  P({ slug: 'efs-2', author: 'owner', title: 'Embeddings from scratch, part two: the model is the easy part',
    description: 'Contrastive training, minus the mystique.', tags: ['embeddings'], series: ['embeddings-from-scratch', 2],
    pubDaysAgo: 48, engage: 'medium', bodySpec: { len: 'medium', features: ['headings', 'math-display', 'code:python'] } }),
  P({ slug: 'efs-3', author: 'owner', title: 'Embeddings from scratch, part three: measuring what you built',
    description: 'The eval that would have saved me a quarter.', tags: ['embeddings', 'eval'], series: ['embeddings-from-scratch', 3],
    pubDaysAgo: 40, engage: 'heavy', bodySpec: { len: 'medium', features: ['headings', 'plotly', 'table', 'math-inline'] } }),

  // Series: "Measuring models" — 4 declared, 2 published (planned parts show "soon").
  P({ slug: 'mm-1', author: 'owner', title: 'Measuring models, part one: the metric is a hypothesis',
    description: 'Your headline number is a claim; treat it like one.', tags: ['eval', 'meta'], series: ['measuring-models', 1],
    pubDaysAgo: 30, engage: 'medium', bodySpec: { len: 'medium', features: ['headings', 'math-inline', 'lists', 'blockquote'] } }),
  P({ slug: 'mm-2', author: 'owner', title: 'Measuring models, part two: offline lies, online tells',
    description: 'Why the leaderboard and production disagree.', tags: ['eval', 'serving'], series: ['measuring-models', 2],
    pubDaysAgo: 18, engage: 'medium', bodySpec: { len: 'medium', features: ['headings', 'plotly', 'table', 'code:python'] } }),

  // Series: "Retrieval plumbing" — 3 declared, 2 published.
  P({ slug: 'rp-1', author: 'owner', title: 'Retrieval plumbing, part one: the index is not the memory',
    description: 'What "in the context" hides.', tags: ['retrieval', 'systems'], series: ['retrieval-plumbing', 1],
    pubDaysAgo: 26, engage: 'medium', bodySpec: { len: 'medium', features: ['headings', 'd2', 'code:python', 'blockquote'] } }),
  P({ slug: 'rp-2', author: 'owner', title: 'Retrieval plumbing, part two: rerankers earn their keep',
    description: 'The cheapest quality win most teams skip.', tags: ['retrieval', 'eval'], series: ['retrieval-plumbing', 2],
    pubDaysAgo: 14, engage: 'medium', bodySpec: { len: 'medium', features: ['headings', 'table', 'code:python', 'math-inline'] } }),

  // Standalone essays that sit ACROSS two series' subjects — these are what give the
  // "related reading" and crossing features something real to find within one author.
  P({ slug: 'retrieval-meets-serving', author: 'owner', title: 'Where retrieval meets serving',
    description: 'The two systems everyone builds separately and ships together.', tags: ['retrieval', 'serving', 'latency'],
    pubDaysAgo: 5, engage: 'heavy', bodySpec: { len: 'medium', features: ['headings', 'd2', 'plotly', 'code:python', 'table'] } }),
  P({ slug: 'a-field-guide-to-evals', author: 'owner', title: 'A field guide to evals',
    description: 'An opinionated map of what to measure and when.', tags: ['eval', 'meta', 'embeddings'],
    pubDaysAgo: 7, engage: 'medium', bodySpec: { len: 'long', features: ['headings', 'table', 'lists', 'blockquote', 'math-inline'] } }),

  // Edge cases.
  P({ slug: 'unicode-and-emoji', author: 'owner', title: 'Unicode, 日本語, café, and 🚀 in a title',
    description: 'Non-Latin text, accents, emoji, and RTL snippets — do they survive the pipeline?', tags: ['meta', 'i18n', 'テスト'],
    pubDaysAgo: 9, engage: 'light', bodySpec: { len: 'short', features: ['headings', 'code:python', 'lists'] } }),
  P({ slug: 'the-5-dollar-model', author: 'owner', title: 'The $5 model & other myths (100% "real")',
    description: 'A title full of $, &, %, quotes and <brackets> to prove escaping holds.', tags: ['meta'],
    pubDaysAgo: 11, engage: 'light', bodySpec: { len: 'short', features: ['headings', 'blockquote', 'code:bash'] } }),
  P({ slug: 'no-description', author: 'owner', title: 'A post with no description', description: '',
    tags: [], pubDaysAgo: 13, engage: 'light', bodySpec: { len: 'short', features: ['headings', 'lists'] } }),
  P({ slug: 'tags-galore', author: 'owner', title: 'A post carrying far too many tags',
    description: 'Stress-testing the tag row and the topic index.',
    tags: ['systems', 'serving', 'latency', 'retrieval', 'eval', 'embeddings', 'meta', 'i18n', 'caching', 'benchmarks'],
    pubDaysAgo: 15, engage: 'light', bodySpec: { len: 'short', features: ['headings', 'lists'] } }),

  // Status edges — the three ways a post can exist without being in a public feed.
  P({ slug: 'work-in-progress', author: 'owner', title: 'Work in progress (a draft)',
    description: 'Should never appear publicly; only in the owner drafts.', tags: ['meta'], status: 'draft',
    bodySpec: { len: 'short', features: ['headings', 'lists'] } }),
  P({ slug: 'coming-next-week', author: 'owner', title: 'Scheduled: coming next week',
    description: 'Should be hidden until its publish_at.', tags: ['serving'], status: 'scheduled', publishInDays: 5,
    bodySpec: { len: 'short', features: ['headings', 'lists'] } }),
  P({ slug: 'retired-thoughts', author: 'owner', title: 'Retired thoughts (unlisted)',
    description: 'Reachable by link, not listed in feeds.', tags: ['meta'], visibility: 'unlisted', pubDaysAgo: 60,
    bodySpec: { len: 'short', features: ['headings', 'blockquote'] } }),
];

// ── Subscribers (audience panel) ─────────────────────────────────────────────
export const SUBSCRIBERS = { confirmed: 12, pending: 3, unsubscribed: 2 };
