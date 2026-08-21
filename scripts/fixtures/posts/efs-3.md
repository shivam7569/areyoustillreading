You cannot improve an embedding model you cannot measure, and measuring one is subtler than it looks. The loss going down tells you the model is learning the training pairs. It tells you nothing about whether the space is useful. In this last part I build the evaluation, because a number you trust is worth more than a model you hope about.

## Retrieval metrics, and why nDCG earns its keep

Recall@k answers a blunt question: did the right document land in the top $k$? It's the right metric when a downstream reranker will clean up the order, because then position within the top $k$ doesn't matter and only membership does. But when the embedding ranking *is* the final ranking, position matters enormously, and that's where nDCG comes in. It discounts each hit by its rank, $\mathrm{DCG} = \sum_i \frac{rel_i}{\log_2(i+1)}$, and normalizes against the ideal ordering so the score lands in $[0, 1]$.

I report both, always, because they disagree in the informative direction. A model with high recall and mediocre nDCG is finding the right documents and ordering them badly — a reranker will rescue it. The reverse almost never happens, and when it does, something is wrong with your relevance labels.

## The evaluation table I actually ship

Here is the comparison from the from-scratch model against two baselines, on a held-out set stratified by source exactly as part one insisted.

| model | Recall@10 | nDCG@10 | dim | ms/query |
|-------|-----------|---------|-----|----------|
| BM25 (lexical) | 0.61 | 0.44 | — | 3 |
| pretrained baseline | 0.78 | 0.59 | 768 | 11 |
| ours (part two) | 0.84 | 0.67 | 512 | 9 |

The lexical baseline is not there for decoration. If your dense model can't beat BM25 on Recall, you have not built a retriever — you have built an expensive way to lose to a 1994 algorithm, and it's better to learn that from a table than from production.

## Watch the metrics move, not just their final value

The single most useful plot I keep is Recall@10 and nDCG@10 against training step. The shape tells you what the loss curve hides: whether the model is still improving the *ranking* after it has stopped improving *membership*, which is the window where the projection head is doing its real work.

```python
import plotly.graph_objects as go

fig = go.Figure()
fig.add_trace(go.Scatter(x=steps, y=recall_at_10, name="Recall@10", mode="lines"))
fig.add_trace(go.Scatter(x=steps, y=ndcg_at_10, name="nDCG@10", mode="lines"))
fig.update_layout(
    title={"text": "Retrieval quality over training"},
    xaxis_title="step",
    yaxis_title="score",
)
fig.show()
```

```plotly
{"data":[{"type":"scatter","mode":"lines","name":"Recall@10","x":[0,500,1000,2000,4000,8000,16000],"y":[0.31,0.58,0.71,0.79,0.82,0.84,0.84]},{"type":"scatter","mode":"lines","name":"nDCG@10","x":[0,500,1000,2000,4000,8000,16000],"y":[0.19,0.38,0.51,0.59,0.63,0.66,0.67]}],"layout":{"title":{"text":"Retrieval quality over training"}}}
```

See how Recall flattens around step 8000 while nDCG keeps climbing? That's the model done finding documents and still learning to order them. Stop the run at the Recall plateau and you'd ship a measurably worse ranking for no reason. The metric that's still moving is the one telling you to keep going. Three parts in, that's the whole discipline: the data decides what "near" means, the loss turns it into geometry, and the evaluation is the only thing that tells you whether any of it worked.
