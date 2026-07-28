---
title: "Reading the KV-cache like a systems engineer"
description: "The attention cache is the single biggest lever on inference cost, and most of us treat it as a black box. A working tour of what it stores, why it fragments, and how to think about paging it."
pubDate: 2026-07-28
tags: ["Inference", "KV-cache", "Systems"]
---

The first time I profiled a serving stack under real load, the flame graph told a
story I didn't want to hear. The matrix multiplies I'd spent weeks optimizing were
a rounding error. The cost was **memory** — specifically, the key/value cache that
attention leaves behind on every token. We ship models as if compute were the
scarce resource. In production, the scarce resource is almost always the cache.

This is a working tour of that cache: what it holds, why it fragments, and how the
paging tricks from operating systems map almost one-to-one onto it. No proofs, just
the mental model I wish I'd had two years earlier.

## What the cache actually stores

Every attention layer, for every token it has already seen, keeps a key vector and
a value vector around so the next token doesn't have to recompute them. The size is
depressingly easy to estimate. For a batch of `b` sequences of length `L`, with `T`
transformer layers, `H` heads, and head dimension `d`, the cache in bytes is:

$$
\text{bytes} = 2 \cdot b \cdot L \cdot T \cdot H \cdot d \cdot \text{sizeof(dtype)}
$$

The leading `2` is the one people forget — keys *and* values. Plug in a 7B-class
model at `bf16` and a context of 8k tokens and you are already spending gigabytes
per sequence. The cache grows **linearly with context**, which is why long-context
features quietly wreck your memory budget long before they wreck your latency.

> The model weights are a fixed cost you pay once. The KV-cache is a variable cost
> you pay for every token of every request, forever.
> <cite>— what I now tell every new hire</cite>

## Why it fragments

Here is the part the textbooks skip. Requests arrive and finish at different times,
each holding a cache block whose length you don't know in advance. If you allocate
one contiguous slab per sequence — the obvious thing — you get classic external
fragmentation: plenty of free memory, none of it in a usable shape.

A quick way to see the waste is to compare *reserved* against *used*:

```python
def utilization(sequences, block_size):
    """Fraction of reserved KV memory that actually holds live tokens."""
    used = sum(len(s.tokens) for s in sequences)
    # each sequence rounds its reservation up to a whole number of blocks
    reserved = sum(
        -(-len(s.tokens) // block_size) * block_size  # ceil division
        for s in sequences
    )
    return used / reserved if reserved else 1.0
```

Run that against a naive allocator with realistic traffic and you'll see numbers in
the 30–40% range. More than half your most expensive memory is holding *nothing* —
it's reserved against a sequence that hasn't grown into it yet, or was rounded up to
a block boundary and never filled.

## Paging, borrowed wholesale

The fix is the same one operating systems reached for decades ago: stop pretending
the cache is contiguous. Break it into fixed-size **blocks**, keep a per-sequence
*block table* that maps logical positions to physical blocks, and let a sequence's
blocks live anywhere in memory. Attention reads through the table; the physical
layout is free to be a mess.

```d2
direction: right
seq: Logical sequence {
  t0: "tokens 0–15"
  t1: "tokens 16–31"
  t2: "tokens 32–47"
}
table: Block table
pool: Physical blocks {
  b7: block 7
  b2: block 2
  b9: block 9
}
seq.t0 -> table: index 0
seq.t1 -> table: index 1
seq.t2 -> table: index 2
table -> pool.b7
table -> pool.b2
table -> pool.b9
```

Two things fall out of this design almost for free. Copy-on-write **prefix sharing**:
two requests with the same system prompt point their first few block-table entries at
the *same* physical blocks until one of them diverges. And near-perfect utilization —
the only waste left is at most one partially-filled block per sequence, the internal
fragmentation you already accepted when you chose a block size.

Wiring it into a scheduler is less code than you'd expect:

```python
class BlockAllocator:
    def __init__(self, num_blocks, block_size):
        self.free = list(range(num_blocks))
        self.block_size = block_size

    def allocate(self, n_tokens):
        need = -(-n_tokens // self.block_size)      # ceil to whole blocks
        if need > len(self.free):
            raise MemoryError("KV pool exhausted — apply backpressure")
        return [self.free.pop() for _ in range(need)]

    def free_blocks(self, blocks):
        self.free.extend(blocks)                     # O(1) return to the pool
```

The scheduler's job then becomes almost boring: admit a request only if
`allocate` can satisfy it, and when the pool is full, apply backpressure instead of
letting an out-of-memory error take the whole server down with it. A little bash to
watch the pool while you tune block size:

```bash
watch -n1 'curl -s localhost:8000/metrics \
  | grep kv_pool | awk "{printf \"%-24s %s\n\", \$1, \$2}"'
```

## What this buys you

None of this touches model quality. It's pure systems work, and the payoff is the
kind you can put on a slide: higher batch sizes at the same memory, prefix sharing
that makes multi-turn chat nearly free, and a graceful-degradation story when load
spikes instead of a cliff. The reranking and prompt-engineering work gets the
attention, but the cache is where the money is.

If you take one thing from this: the next time someone asks how to make inference
cheaper, don't start with the model. Start with the memory it leaves behind.
