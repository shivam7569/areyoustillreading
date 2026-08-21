In part one I argued the index only knows geometry: it returns the nearest neighbors and stays silent about whether any of them answer the question. That silence is exactly the gap the reranker fills. The retriever optimizes for recall at high $k$ — cast a wide net, cheaply. The reranker optimizes for precision at low $m$ — read the net carefully, expensively. They are different jobs, and trying to make one do both is where retrieval quality goes to die.

The cost asymmetry is the reason the two-stage design exists at all. A bi-encoder retriever embeds the query once and does an approximate nearest-neighbor search, so its cost is roughly independent of the corpus size you scan. A cross-encoder reranker runs the full model over each `(query, document)` pair, so its cost is $O(m \cdot L)$ in the number of candidates $m$ and their length $L$. You cannot afford to cross-encode the whole corpus, which is precisely why you retrieve first and rerank second.

## The division of labor

| Stage     | Model type    | Cost       | Optimizes for | Typical width |
|-----------|---------------|------------|---------------|---------------|
| Retrieve  | bi-encoder    | cheap      | recall        | $k = 64$–$512$ |
| Rerank    | cross-encoder | expensive  | precision     | $m = 5$–$20$   |

The widths in that last column are the actual knobs. Retrieve wide enough that the right answer is *somewhere* in the candidate set; rerank narrow enough that you can afford the cross-encoder and the model downstream isn't drowning in near-misses.

## The reranker in practice

The reranker takes the retriever's candidates and re-scores each one against the query with a model that actually reads both together. Then it sorts and truncates.

```python
def rerank(query: str, candidates: list[dict], cross_encoder, m: int = 10):
    pairs = [(query, c["body"]) for c in candidates]
    scores = cross_encoder.predict(pairs)   # O(len(candidates)) model passes
    for c, s in zip(candidates, scores):
        c["score"] = float(s)
    ranked = sorted(candidates, key=lambda c: c["score"], reverse=True)
    return ranked[:m]
```

The important line is `cross_encoder.predict` running over every candidate. That is the expense you deliberately bounded by retrieving a fixed $k$ upstream. Widen $k$ and you buy recall at linear rerank cost; that trade is the entire tuning surface of the two-stage system.

## Why it earns its keep

The reranker justifies its latency because it sees what the retriever structurally cannot: term overlap, negation, and the fine-grained interaction between query and passage that a single dot product in embedding space flattens away. The retriever knows the passage is *nearby*. The reranker knows whether it actually *answers*. On the query sets I care about, adding a cross-encoder over the top 64 candidates moves precision@5 more than any amount of tuning the embedding model does — because it is finally reading the pair instead of comparing two summaries of it.

That is the whole argument for the second stage. Retrieval decides what's plausible; reranking decides what's right; and keeping those two jobs in separate models, each cheap at what it does, is what lets the system be both fast and correct instead of neither.
