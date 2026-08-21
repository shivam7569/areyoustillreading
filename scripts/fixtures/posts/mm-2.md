The offline number always looks better than the online one. Not sometimes — structurally. Offline you evaluate on a distribution you curated, with labels you trust, against a baseline that cannot react. Online the traffic is adversarial, the labels are behavioral and noisy, and the system you shipped changes the very users it is being measured on. Part one was about what a metric assumes. Part two is about the gap between the two rooms where you read it.

## The gap is not noise, it is direction

I have stopped being surprised when an offline win of five points evaporates to one point online, or reverses. The offline set overweights the cases you thought to collect. Anything the model fails on that you never imagined is, by construction, absent from your test set and present in production. So offline optimism is not random error — it is a bias with a sign.

Here is a small harness I use to measure the gap rather than argue about it:

```python
import numpy as np

def offline_online_gap(offline_scores, online_scores):
    # paired by experiment arm
    off = np.asarray(offline_scores)
    on = np.asarray(online_scores)
    delta = off - on
    return {
        "mean_gap": float(delta.mean()),
        "pct_arms_offline_optimistic": float((delta > 0).mean()),
        "corr": float(np.corrcoef(off, on)[0, 1]),
    }

print(offline_online_gap(
    offline_scores=[0.82, 0.78, 0.90, 0.71, 0.85],
    online_scores =[0.61, 0.63, 0.70, 0.66, 0.62],
))
```

The number I actually care about is `corr`. If offline and online move together — even at an offset — offline is a usable proxy and I can iterate fast on it. If the correlation is weak, offline is a slot machine, and every green dashboard is a coin flip dressed as evidence.

## What the gap looks like

```python
import plotly.graph_objects as go

fig = go.Figure()
fig.add_trace(go.Scatter(x=[0.82,0.78,0.90,0.71,0.85],
                         y=[0.61,0.63,0.70,0.66,0.62],
                         mode="markers", name="arms"))
fig.add_trace(go.Scatter(x=[0.70,0.92], y=[0.70,0.92],
                         mode="lines", name="y = x"))
fig.update_layout(title={"text": "Offline vs online per arm"})
fig.show()
```

```plotly
{"data":[{"type":"scatter","mode":"markers","name":"arms","x":[0.82,0.78,0.90,0.71,0.85],"y":[0.61,0.63,0.70,0.66,0.62],"marker":{"size":11}},{"type":"scatter","mode":"lines","name":"y = x","x":[0.70,0.92],"y":[0.70,0.92],"line":{"dash":"dash"}}],"layout":{"title":{"text":"Offline vs online per arm"},"xaxis":{"title":{"text":"offline score"}},"yaxis":{"title":{"text":"online score"}}}}
```

Every point sits below the diagonal. That is the structural optimism, drawn. A well-calibrated offline harness would scatter around the line, not sit entirely beneath it.

## Reading each side for what it is good at

The two rooms answer different questions, and I stopped asking them to agree:

| Property | Offline | Online |
| --- | --- | --- |
| Iteration speed | Minutes | Days to weeks |
| Label trust | High, curated | Low, behavioral |
| Distribution | Frozen, your choosing | Live, shifting |
| Detects unknown failures | No | Yes |
| Confounded by feedback loops | No | Yes |
| Good for | Ranking candidates | Deciding launches |

Offline tells you which handful of changes are worth an experiment. Online tells you which one to ship. Use offline to lie to yourself quickly and cheaply, then let online tell you the truth slowly. Any team that inverts that order — shipping on offline, validating rarely online — is optimizing the proxy and calling it progress.
