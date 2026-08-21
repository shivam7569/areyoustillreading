The most expensive misunderstanding I see in retrieval systems is treating the index as though it were the model's memory. It isn't. The index is a lookup structure over things you happened to write down; the model's memory is the parameters. Conflating the two leads people to expect the index to "know" things it was never given, and to be surprised when it returns stale or missing answers with total confidence.

An index is a function from a query vector to a set of candidate ids, and nothing more. It has no notion of truth, recency, or relevance beyond geometric proximity in whatever embedding space you built it in. If the embedding is bad, the index faithfully returns the wrong neighbors. If a document was never indexed, the index cannot tell you it's missing — it just returns the next-nearest thing and lets you believe it.

## The pipeline, and where memory actually lives

```d2
query -> embed -> index -> candidates -> model
corpus -> embed
embed -> index
index: {shape: cylinder}
```

Notice that `corpus` and `query` pass through the *same* `embed` step. That shared encoder is the real contract of the system: the index is only meaningful to the extent that query and document embeddings live in the same space. Change the encoder on one side and not the other and the index silently becomes noise.

## What retrieval returns

Here is the shape of it. Retrieval hands you ids and distances — it does not hand you answers, and the distinction is the whole point.

```python
def retrieve(query: str, encoder, index, k: int = 20):
    qv = encoder.encode(query)
    dists, ids = index.search(qv[None, :], k)
    # note: distances, not confidences. proximity is not correctness.
    return [
        {"id": int(i), "distance": float(d)}
        for i, d in zip(ids[0], dists[0])
    ]
```

The candidates come back ranked by distance. That ranking is a statement about geometry, not about whether the passage answers the question. Turning proximity into relevance is the reranker's job, and that is the subject of part two.

## Why the distinction earns its keep

When someone reports that "the model forgot X," the first question is never about the model. It's whether X was in the corpus, whether it was embedded with the current encoder, and whether it survived the last rebuild. Nine times out of ten the answer is upstream of the index entirely.

> Your index knows what you fed it, embedded the way you embedded it, as of when you last rebuilt it. It knows nothing else, and it will never tell you so.

Hold that distinction and most retrieval bugs stop being mysterious. The index is a filing cabinet, not a mind. The next post is about the clerk who decides which of the returned files is actually worth reading.
