Retrieval and serving get talked about as if they were two different teams with two different pagers. One side owns recall and the shape of the index; the other owns tail latency and the size of the pods. We wrote this together because the interesting failures happen in the seam between them — the place where a retriever's honest 40ms turns into a user's 900ms, and nobody's dashboard is lying.

The mental model we kept coming back to is that a retrieval-augmented request is not one system with a bolt-on lookup. It is a small pipeline where every hop has its own queue, its own failure mode, and its own idea of what "fast" means. Draw it once and the arguments get shorter.

```d2
query -> embed -> retriever
retriever -> reranker -> model -> response
cache: {shape: cylinder}
query -> cache
cache -> response
retriever -> vectors: {shape: cylinder}
```

## The seam is a queue, not a function call

When Mira first sketched the retriever in isolation, it looked like a pure function: text in, top-k passages out. When Shivam put it behind the serving layer, it became a queue with a admission policy. The retriever's p50 barely moved under load, but its p99 walked off a cliff the moment the embedding step and the reranker started contending for the same CPU the model's tokenizer wanted.

The fix was boring and correct: give the pipeline explicit budgets instead of hoping. Each stage gets a slice of the total, and a stage that blows its slice returns whatever it has rather than blocking the ones downstream.

```python
import asyncio

STAGE_BUDGETS_MS = {"embed": 15, "retrieve": 40, "rerank": 25}

async def with_budget(name, coro, fallback):
    budget = STAGE_BUDGETS_MS[name] / 1000
    try:
        return await asyncio.wait_for(coro, timeout=budget)
    except asyncio.TimeoutError:
        # Degrade, don't stall: a slower stage must not eat
        # the model's share of the request deadline.
        return fallback

async def pipeline(q, embedder, index, reranker):
    vec = await with_budget("embed", embedder(q), fallback=None)
    if vec is None:
        return []  # skip retrieval entirely rather than miss the deadline
    hits = await with_budget("retrieve", index.search(vec, k=50), fallback=[])
    ranked = await with_budget("rerank", reranker(q, hits), fallback=hits[:8])
    return ranked[:8]
```

The important line is the comment, not the code. A degraded answer that arrives inside the deadline beats a perfect one the user already cancelled.

## Where the latency actually goes

We instrumented every hop and stopped trusting our intuitions. The reranker, which everyone assumed was cheap because the candidate set is small, turned out to be the single most variable stage — a cross-encoder is a real forward pass, and under contention it was the first thing to starve.

```python
import plotly.graph_objects as go

stages = ["embed", "retrieve", "rerank", "generate"]
p50 = [12, 34, 21, 180]
p99 = [19, 61, 140, 240]
fig = go.Figure()
fig.add_bar(name="p50", x=stages, y=p50)
fig.add_bar(name="p99", x=stages, y=p99)
fig.update_layout(title=dict(text="Per-stage latency (ms)"), barmode="group")
fig.show()
```

```plotly
{"data":[{"type":"bar","name":"p50","x":["embed","retrieve","rerank","generate"],"y":[12,34,21,180]},{"type":"bar","name":"p99","x":["embed","retrieve","rerank","generate"],"y":[19,61,140,240]}],"layout":{"title":{"text":"Per-stage latency (ms)"},"barmode":"group"}}
```

Generation dominates p50, as you'd expect. But the gap between p50 and p99 on the reranker is where the pain lived — a 21ms median hiding a 140ms tail. That tail is exactly what the budget above clamps.

## Deciding what to actually run

Once the stages have budgets, the remaining question is which of them earn their place per request. Not every query needs a reranker, and cheap queries that hit the cache need none of it. We ended up with a small routing table rather than a clever model, and the table has been easier to reason about than anything adaptive we tried.

| Query class | Retrieve | Rerank | Cache TTL | Typical p99 |
|---|---|---|---|---|
| Cached exact | no | no | 6h | 8ms |
| Short factual | k=20 | no | 1h | 190ms |
| Ambiguous | k=50 | yes | 15m | 320ms |
| Long-form synthesis | k=80 | yes | none | 640ms |

The lesson we'd underline: retrieval quality and serving cost are the same knob viewed from two ends. Raising k buys recall and spends tail latency; the reranker buys precision and spends the same. The teams that ship well are the ones who stop pretending those are separate budgets and start spending them out of one wallet.

That's the seam. It isn't glamorous, and it doesn't show up in either team's benchmark until it's a page. But it's where retrieval meets serving, and it's the part worth staffing.
