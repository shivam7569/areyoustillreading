Every post I write is a small integration test. It exercises the prose pipeline, the math renderer, the diagram compiler, the syntax highlighter, and the image layout in one pass, and if any of them regress I find out by reading rather than by staring at CI. So this one is deliberate: I am going to pull every knob at once and see whether the page holds. Consider it a stress test disguised as an essay.

The premise is simple. A serving system has a handful of levers — batch size, cache policy, retrieval depth, rerank cutoff — and none of them are independent. You cannot tune latency without touching recall, and you cannot chase recall without paying for compute. The interesting work is in the coupling, and a single post is a decent place to hold the whole thing in view.

## The shape of the pipeline

Here is the path a request actually takes. Nothing exotic, but every box is a knob.

```d2
query -> retriever -> reranker -> model -> response
retriever -> cache
cache: {shape: cylinder}
reranker -> cache
```

The cache sits off to the side because it serves two masters: it short-circuits retrieval on repeat queries, and it memoizes rerank scores for hot documents. That dual role is where most of the subtle bugs live.

<aside class="mnote"><b>Aside</b> The cache is the only component here that can make your evaluation numbers go *up* while making the user experience go *down* — stale hits look like wins offline.</aside>

## Recall is a budget, not a target

Let me be precise about what we are trading. If we retrieve $k$ candidates and the reranker keeps $m \le k$, then expected end-to-end recall factors into a retrieval term and a rerank term. Writing $R$ for recall and $P$ for precision at the cutoff, the quantity I actually optimize is the harmonic blend

$$
F_\beta = (1 + \beta^2)\cdot\frac{P \cdot R}{\beta^2 P + R}, \qquad \beta = 2.
$$

I pick $\beta = 2$ because in retrieval a miss costs more than a stray candidate — the model can ignore a bad passage but it cannot conjure a missing one.

## The retriever

The embedding side is the cheap part to get wrong. Here is the core of the query path — encode, normalize, search — with the normalization made explicit because a surprising number of index bugs are just an un-normalized vector meeting a cosine index.

```python
import numpy as np

def search(query: str, encoder, index, k: int = 64) -> list[int]:
    v = encoder.encode(query)
    v = v / (np.linalg.norm(v) + 1e-8)   # cosine index expects unit vectors
    scores, ids = index.search(v[None, :], k)
    return ids[0].tolist()
```

The hot loop, though, is not in Python. The scoring kernel is where the latency budget is spent, so it lives in Rust and gets called per shard.

```rust
/// Dot-product score against a packed shard of unit vectors.
pub fn score_shard(query: &[f32], shard: &[f32], dim: usize) -> Vec<f32> {
    shard
        .chunks_exact(dim)
        .map(|doc| {
            query.iter().zip(doc).map(|(q, d)| q * d).sum::<f32>()
        })
        .collect()
}
```

## Where the candidates come from

Retrieval depth is not free, and the place it shows up on the bill is the database. The rerank stage needs the raw documents back, and this join is run on every request:

```sql
SELECT d.id, d.body, d.updated_at
FROM documents d
JOIN candidate_ids c ON c.doc_id = d.id
WHERE d.tenant_id = $1
ORDER BY c.rank ASC
LIMIT 64;
```

Widen `LIMIT` and recall improves; widen it too far and the reranker becomes the bottleneck while the tail latency quietly doubles.

## What the knobs actually cost

I ran the same query set across four configurations. The numbers are median over 10k queries, single region, warm cache.

| Config       | depth $k$ | rerank $m$ | recall@10 | p50 (ms) | p99 (ms) |
|--------------|-----------|------------|-----------|----------|----------|
| lean         | 16        | 4          | 0.71      | 22       | 61       |
| balanced     | 64        | 8          | 0.86      | 38       | 104      |
| deep         | 256       | 16         | 0.91      | 91       | 288      |
| deep + cache | 256       | 16         | 0.91      | 47       | 133      |

The last row is the whole point: the cache buys back most of the latency of the deep config without touching recall. That is the only free lunch on the menu, and it is only free because query traffic is Zipfian.

The same data, as a curve, because the shape matters more than the cells:

```python
import plotly.graph_objects as go

fig = go.Figure()
fig.add_trace(go.Scatter(
    x=[16, 64, 256, 256],
    y=[61, 104, 288, 133],
    mode="markers+text",
    text=["lean", "balanced", "deep", "deep+cache"],
    textposition="top center",
))
fig.update_layout(title={"text": "Retrieval depth vs p99 latency"})
fig.show()
```

```plotly
{"data":[{"type":"scatter","mode":"markers+text","x":[16,64,256,256],"y":[61,104,288,133],"text":["lean","balanced","deep","deep+cache"],"textposition":"top center","marker":{"size":12}}],"layout":{"title":{"text":"Retrieval depth vs p99 latency"},"xaxis":{"title":{"text":"candidate depth k"}},"yaxis":{"title":{"text":"p99 latency (ms)"}}}}
```

## The rule I keep coming back to

> Every parameter you expose is a promise to tune it. If you can't say what you'd measure to move it, delete the knob.

That is the discipline. A config field with no owning metric is not flexibility, it is a future incident.

![A rack of servers, which is where these knobs eventually live](https://picsum.photos/seed/every-knob/900/480)

So, the checklist this post was really about:

- **Depth** buys recall at superlinear latency cost — cap it at the knee.
- **Rerank cutoff** is where precision is won; keep it small and honest.
- **Cache** is the only lever that helps two metrics at once, and the only one that can lie to you offline.
- **Normalization** is not a knob, it is a correctness invariant — assert it.

If you are reading this and the math rendered, the diagram drew, the code highlighted, and the plot rotated, then the page held. That was the actual test.
