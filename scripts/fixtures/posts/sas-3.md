We have been treating the batch as a set of slots, and I have been quietly lying about what a slot costs. A slot is not a scheduling abstraction. It is physical memory — a growing stack of key and value tensors that we must keep for every token of every active sequence, for the entire life of that request. The KV cache is the real constraint on how many conversations a GPU can hold at once, and almost every serving decision I make is downstream of this one number.

## Why the cache exists

During decode, generating token $n$ needs to attend to all previous tokens. Recomputing their keys and values every step would make decode quadratic. So we cache them. The cost of that cache, per sequence, is linear in sequence length and grows every single step. Concretely, the bytes held for one sequence are:

$$
\text{KV bytes} = 2 \cdot L \cdot n_{layers} \cdot n_{kv} \cdot d_{head} \cdot b
$$

where $L$ is the current length, $n_{kv}$ the number of key/value heads, $d_{head}$ the head dimension, $b$ the bytes per element, and the leading $2$ is keys plus values. Multiply by every active sequence and you have the memory the scheduler is actually spending. Weights are a fixed cost you pay once. The KV cache is a variable cost that scales with concurrency times context length, and it is the thing that OOMs you at 3 a.m.

## The fragmentation problem

The naive implementation gives each sequence one contiguous buffer sized to the maximum length it *might* reach. This is catastrophic. A request that ends up generating 30 tokens still reserved space for 2048. The memory you "used" and the memory you "needed" diverge wildly, and effective batch size collapses.

| Strategy | Reserved per seq | Utilization | Notes |
|---|---|---|---|
| Contiguous max-length | 2048 tokens | ~20–40% | Huge internal waste; small effective batch |
| Contiguous, right-sized | actual length | ~60% | Needs realloc/copy as it grows |
| Paged (block table) | rounded to block | ~90%+ | Non-contiguous; slight indirection cost |

Paged attention is the move that fixed this: chop the cache into fixed-size blocks, keep a per-sequence block table mapping logical positions to physical blocks, and allocate blocks on demand. It is virtual memory for the KV cache, and it turns the utilization from embarrassing into respectable.

## What utilization does to throughput

The reason I care so much is that memory utilization is not a tidiness metric — it converts directly into how many sequences fit, and therefore into throughput. Here is the relationship I show people when they ask why we bothered with paging.

```python
import plotly.graph_objects as go

util = [0.3, 0.5, 0.7, 0.9]
# Effective concurrent sequences that fit at each utilization level.
seqs = [18, 30, 42, 54]

fig = go.Figure(
    go.Bar(x=[f"{int(u*100)}%" for u in util], y=seqs,
           marker_color="#7a5c8e")
)
fig.update_layout(
    title={"text": "KV utilization vs. concurrent sequences"},
    xaxis_title="cache utilization",
    yaxis_title="sequences on one GPU",
)
fig.show()
```

```plotly
{"data":[{"type":"bar","x":["30%","50%","70%","90%"],"y":[18,30,42,54],"marker":{"color":"#7a5c8e"}}],"layout":{"title":{"text":"KV utilization vs. concurrent sequences"},"xaxis":{"title":{"text":"cache utilization"}},"yaxis":{"title":{"text":"sequences on one GPU"}}}}
```

Tripling utilization roughly triples the crowd you can serve at a given latency. That is not a micro-optimization; that is the difference between one GPU and three.

## Levers once paging is in

Once the cache is paged, the interesting knobs are all about shrinking bytes per token or reclaiming blocks:

- **Grouped-query attention** cuts $n_{kv}$ by sharing key/value heads across query heads — often an order-of-magnitude reduction in cache size for a small quality cost.
- **Quantized KV** stores keys and values in 8-bit or lower, halving $b$ at some accuracy risk on long context.
- **Prefix sharing** lets many requests with the same system prompt point at the same physical blocks instead of each holding a copy.
- **Preemption** evicts a sequence's blocks to host memory under pressure and recomputes or swaps them back — trading latency for not crashing.

## The mental model I keep

I have stopped thinking of KV cache as an optimization and started thinking of it as the budget line. Weights buy you the ability to answer at all. The KV cache buys you the ability to answer *many people at once*, and it is priced per token per layer per sequence, billed continuously. Every serving feature I respect — paging, GQA, prefix sharing — is really a way of buying more sequences with the same fixed slab of HBM. Speculative decoding, next, is the one big idea that does *not* attack memory, and that is exactly why it is worth its own honest accounting.
