Every time someone says "just add retrieval," I picture the eight boxes that phrase quietly commits us to running in production. Retrieval is not a component; it is a small distributed system with its own latency budget, its own failure modes, and its own places to lie to yourself about recall. I want to walk the whole path once, end to end, the way I'd trace a slow request at two in the morning.

## The shape of the path

A query comes in as text. Before it touches an index it gets normalized, maybe expanded, maybe rewritten by a small model. Then it fans out: a dense path that embeds the query and searches a vector index, and often a lexical path that does the boring, reliable BM25 thing. The two candidate sets get fused, a reranker sorts the survivors, and only then does anything reach the generator.

```d2
query -> rewrite -> embed
query -> lexical
embed -> ann: {shape: cylinder}
lexical -> bm25: {shape: cylinder}
ann -> fuse
bm25 -> fuse
fuse -> reranker
reranker -> model
```

The thing I want to stress is that each arrow is a hop with its own p99. The dense path is usually where people look, but I have watched a lexical fallback add forty milliseconds because someone left a wildcard analyzer on the title field.

## Who talks to whom

It helps to see the request as a conversation between services rather than a pipeline diagram. The orchestrator is the one holding the deadline, and every downstream call is spending its budget.

```d2
shape: sequence_diagram
client: Client
orch: Orchestrator
emb: Embedder
idx: Vector index
rr: Reranker
llm: Generator

client -> orch: query
orch -> emb: embed(query)
emb -> orch: vector
orch -> idx: topK(vector)
idx -> orch: 200 candidates
orch -> rr: rerank(query, candidates)
rr -> orch: top 8
orch -> llm: prompt + context
llm -> client: answer
```

Notice the reranker sees two hundred candidates and returns eight. That fan-in is where most of the quality lives and most of the tail latency hides. Reranking is quadratic-feeling in practice: cross-encoders are accurate and slow, and the number you feed them is a dial you will end up tuning against your SLO, not your eval set.

## What actually goes wrong

The failures cluster into a small number of shapes, and once you have named them you start seeing them everywhere:

- **Recall cliffs.** The index returns plausible neighbors that are all subtly off-topic because the embedding model never saw your domain vocabulary.
- **Fusion that averages away signal.** Naive score-blending between BM25 and cosine similarity, on incomparable scales, quietly demotes the one exact-match document.
- **Reranker starvation.** Under load you cut the candidate count to hit latency, and quality degrades in a way no dashboard shows unless you are watching offline eval on live traffic.
- **Stale chunks.** The document changed; the embedding did not.

> The index isn't wrong. It's answering the question you actually asked, which is rarely the question you meant.
> — a note I keep pinned above my desk

## Where I'd spend the budget

If I had one afternoon to improve a retrieval stack I would not touch the embedding model first. I would, in order:

1. Add a lexical path if there isn't one, because exact matches are cheap and users notice when they break.
2. Fix fusion to use rank-based combination (reciprocal rank fusion) instead of raw scores.
3. Instrument the reranker's input size as a first-class metric next to p99.
4. Only then argue about which embedding model to fine-tune.

The stack is a budget. Spend it where the tail is, not where the hype is.
