/*
 * scripts/judge-pairs.mjs — decide which eligible post pairs are worth reading together.
 * ===========================================================================
 * The rules in db/reading-pairs-llm.sql decide who is ELIGIBLE (published, public, live
 * authors, and two genuinely disjoint author sets). They cannot decide whether two essays
 * actually reach the same subject — a shared tag was the old proxy for that, and it paired
 * a rendering-stack demo with an evals guide because both carried "meta".
 *
 * This script asks a model that question instead, once per pair, and stores the verdict.
 * Nothing runs at page-load time: the site reads the stored rows.
 *
 * The model is allowed — expected — to say NO. That refusal is the whole point: it is the
 * judgement the tag test could never make. An empty section is a correct outcome.
 *
 * Usage:
 *   node --env-file=.env scripts/judge-pairs.mjs --dry            # judge, print, write nothing
 *   node --env-file=.env scripts/judge-pairs.mjs --limit 20
 *   node --env-file=.env scripts/judge-pairs.mjs --anchor <postId>  # one post vs the rest
 */
import { GoogleGenAI } from '@google/genai';
import { getPool } from './_shared.mjs';

const MODEL = process.env.PAIR_JUDGE_MODEL || 'gemini-3.6-flash';
const PROMPT_VERSION = 1;
const EXCERPT = 1500; // chars of body given to the judge — enough to see what a piece argues

const argv = process.argv.slice(2);
const flag = (n, d = null) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const DRY = argv.includes('--dry');
const LIMIT = parseInt(flag('--limit', '500'), 10);
const ANCHOR = flag('--anchor', null);

const SCHEMA = {
  type: 'object',
  properties: {
    related: { type: 'boolean' },
    score: { type: 'number' },
    subject: { type: 'string' },
    reason: { type: 'string' },
  },
  required: ['related', 'score', 'subject', 'reason'],
};

const SYSTEM = `You decide whether two essays from a multi-author engineering publication are worth
reading side by side, for a section called "Read them together".

Say YES only when the two genuinely engage the SAME underlying subject or problem, closely enough that
reading one makes the other more interesting. Two pieces that merely sit in the same broad field, or
share a housekeeping label, are NOT related — say no. A shared tag proves nothing.

Be strict. An empty section is much better than a weak pairing: this is the most prominent
recommendation on the page, and a bad pair costs the publication credibility.

Rules for what you write:
- "reason": ONE sentence, under 25 words, naming the specific thing both pieces take up. Describe only
  what the given text actually shows. Never invent a claim, a quote, a finding, or a disagreement
  between the authors. If you cannot name the shared thing concretely, that means related=false.
- "subject": 1-4 words a reader would recognise, in plain language. Never echo a raw tag like "meta".
  Write it lowercase unless a word is a proper noun or an initialism (Postgres, RAG, D2): it is printed
  mid-sentence as "Both take up <subject>", so a capitalised first word reads as a mistake there.
- "score": 0-1 confidence that a thoughtful reader would find this pairing worthwhile. Below 0.55,
  set related=false.
- Do not reward two pieces by the same team, a series and its own instalment, or a piece that merely
  mentions the other's topic in passing.`;

const postBlock = (p, n) => `--- ESSAY ${n} ---
Title: ${p.title}
Summary: ${p.description || '(none)'}
Tags: ${(p.tags || []).join(', ') || '(none)'}
Opening: ${(p.excerpt || '').replace(/\s+/g, ' ').slice(0, EXCERPT)}`;

async function main() {
  if (!process.env.GOOGLE_AI_STUDIO_API_KEY) throw new Error('GOOGLE_AI_STUDIO_API_KEY missing from .env');
  const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_STUDIO_API_KEY });
  const pool = getPool();
  try {
    const { rows } = await pool.query(
      `select c.a_id, c.b_id, c.a, c.b,
              left(pa.body_text, $3) as a_excerpt,
              left(pb.body_text, $3) as b_excerpt
         from content.reading_pair_candidates($1, $2) c
         join content.posts pa on pa.id = c.a_id
         join content.posts pb on pb.id = c.b_id`,
      [ANCHOR, LIMIT, EXCERPT],
    );
    console.log(`model: ${MODEL}${DRY ? '  (dry run — nothing will be written)' : ''}`);
    console.log(`candidates to judge: ${rows.length}\n`);

    let yes = 0, no = 0, failed = 0;
    for (const r of rows) {
      const a = { ...r.a, excerpt: r.a_excerpt };
      const b = { ...r.b, excerpt: r.b_excerpt };
      let v;
      try {
        const res = await ai.models.generateContent({
          model: MODEL,
          contents: `${postBlock(a, 1)}\n\n${postBlock(b, 2)}`,
          config: {
            systemInstruction: SYSTEM,
            responseMimeType: 'application/json',
            responseSchema: SCHEMA,
            temperature: 0,
          },
        });
        v = JSON.parse(res.text);
      } catch (e) {
        failed++;
        console.log(`  !! ${String(a.title).slice(0, 34)} + ${String(b.title).slice(0, 34)} — ${e.message.slice(0, 80)}`);
        continue;
      }
      // Trust the rules, not the model, for the threshold.
      const related = !!v.related && Number(v.score) >= 0.55;
      related ? yes++ : no++;
      console.log(`  ${related ? 'PAIR' : ' no '} ${Number(v.score).toFixed(2)}  ${String(a.title).slice(0, 30)} + ${String(b.title).slice(0, 30)}`);
      if (related) console.log(`        ${v.subject} — ${v.reason}`);

      if (!DRY) {
        await pool.query(
          `insert into content.reading_pairs (a_id, b_id, related, score, subject, reason, model, prompt_version)
           values ($1,$2,$3,$4,$5,$6,$7,$8)
           on conflict (a_id, b_id) do update set
             related = excluded.related, score = excluded.score, subject = excluded.subject,
             reason = excluded.reason, model = excluded.model,
             prompt_version = excluded.prompt_version, judged_at = now()`,
          [r.a_id, r.b_id, related, Math.min(1, Math.max(0, Number(v.score) || 0)),
           String(v.subject || '').slice(0, 80), String(v.reason || '').slice(0, 300), MODEL, PROMPT_VERSION],
        );
      }
    }
    console.log(`\njudged ${rows.length}: ${yes} pairs kept, ${no} rejected, ${failed} failed`);
  } finally {
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
