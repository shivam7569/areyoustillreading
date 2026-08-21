Nobody argues about the mean latency of a serving stack once they've seen the distribution. The mean is a story the tail tells to keep you calm. I spent a week instrumenting our retrieval-plus-rerank path, exporting every span, and the first thing I did with the data was refuse to summarize it. I plotted it instead, because the shape of a latency distribution is the argument, and no single number carries the shape.

## The distribution, not the number

Here is the request-latency histogram from a normal afternoon of traffic against the embedding-serving tier. The bulk sits where you'd hope, but the right side keeps going — that long thin stretch past 200ms is where retries, cold shards, and GC pauses live.

```python
import plotly.graph_objects as go

fig = go.Figure(
    go.Histogram(x=latencies_ms, nbinsx=40, marker_color="#7c4dff")
)
fig.update_layout(
    title={"text": "Request latency (ms), one afternoon"},
    xaxis_title="latency (ms)",
    yaxis_title="count",
)
fig.show()
```

```plotly
{"data":[{"type":"histogram","x":[41,44,46,47,48,49,50,50,51,52,52,53,54,55,55,56,58,60,62,64,66,70,74,80,88,97,110,128,150,182,214,260],"marker":{"color":"#7c4dff"}}],"layout":{"title":{"text":"Request latency (ms), one afternoon"}}}
```

## Percentiles are a table, and the table is honest

When someone asks "how fast is it," I hand them the percentile table, not the average. The gap between p50 and p99 is the real service-level story — it tells you how much of your capacity planning is spent defending the unlucky requests.

| percentile | latency (ms) | what lives here |
|-----------|-------------|-----------------|
| p50 | 54 | warm shard, cache hit |
| p90 | 88 | warm shard, cache miss |
| p99 | 182 | cold shard or reranker queue |
| p99.9 | 340 | GC pause, retry, node under memory pressure |

## Latency is a surface, not a line

The part people miss: latency isn't one-dimensional. It moves with both batch size and sequence length, and the interaction between them is where the surprises hide. Small batches with long sequences behave nothing like large batches with short ones. I sampled the grid and rendered it as a surface, and the curvature told me exactly where our batching heuristic was making the wrong call.

```python
import plotly.graph_objects as go

fig = go.Figure(
    go.Surface(z=latency_grid, x=batch_sizes, y=seq_lengths, colorscale="Viridis")
)
fig.update_layout(
    title={"text": "p99 latency (ms) vs batch size and sequence length"},
    scene=dict(
        xaxis_title="batch size",
        yaxis_title="seq length",
        zaxis_title="p99 ms",
    ),
)
fig.show()
```

```plotly
{"data":[{"type":"surface","x":[1,8,32,128],"y":[16,64,256,512],"z":[[38,42,58,96],[44,52,78,150],[70,92,140,260],[120,168,250,430]],"colorscale":"Viridis"}],"layout":{"title":{"text":"p99 latency (ms) vs batch size and sequence length"}}}
```

Once you can see the surface, the tuning stops being folklore. You pick the ridge you can afford and you batch to stay off the cliff. Everything else is instrumentation.
