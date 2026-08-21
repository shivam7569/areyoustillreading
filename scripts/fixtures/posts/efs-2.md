Having spent part one insisting the data does the deciding, I owe you the model — and an honest admission that the model is the part I worry about least. The architecture is a settled question for most purposes: a transformer encoder, mean-pooled, projected, normalized. The interesting decisions all live in the loss, because the loss is where the pairs from part one become geometry.

## The objective

The workhorse is InfoNCE — a softmax over similarities where the positive has to beat every negative in the batch. For a query $q$ with positive $k^+$ and negatives $k^-_i$, with temperature $\tau$:

$$\mathcal{L} = -\log \frac{\exp(\mathrm{sim}(q, k^+)/\tau)}{\exp(\mathrm{sim}(q, k^+)/\tau) + \sum_i \exp(\mathrm{sim}(q, k^-_i)/\tau)}$$

Everything about the model's behavior is hiding in two choices in that expression: the similarity function and the temperature. Use cosine similarity and you are on a hypersphere, where only angle matters and magnitude is thrown away. That is almost always what you want for retrieval, because it makes the space scale-invariant, but it means normalization is not a detail — it is part of the objective.

The temperature $\tau$ is the sharpness dial. Small $\tau$ makes the softmax peaky, which punishes hard negatives hard and can destabilize early training. Large $\tau$ smooths everything and the model stops caring about the difference between a good negative and a great one. I treat it as the most important hyperparameter in the whole run, above learning rate.

## The whole thing, in one function

With normalized embeddings and in-batch negatives, the entire loss collapses into a similarity matrix and a cross-entropy against the diagonal. This is the part that fits on a napkin.

```python
import torch
import torch.nn.functional as F

def info_nce(q, k, temperature=0.05):
    """q, k: (batch, dim). Row i of k is the positive for row i of q.
    Every other row in the batch is an in-batch negative."""
    q = F.normalize(q, dim=-1)
    k = F.normalize(k, dim=-1)
    logits = (q @ k.T) / temperature          # (batch, batch)
    labels = torch.arange(q.size(0), device=q.device)
    return F.cross_entropy(logits, labels)
```

That `q @ k.T` is doing all the work: the diagonal holds the positives, every off-diagonal entry is a negative you got for free by batching. Which is exactly why the effective difficulty of the run scales with batch size — a bigger batch is a harder exam. It is also why the hard-negative mining from part one matters most at small batch sizes, where in-batch negatives are too easy to teach anything past the first epoch.

## Pooling and the projection head

Mean-pooling over tokens beats the CLS token for most encoders that weren't pretrained to use CLS as a summary, and it's worth checking rather than assuming. The projection head — a small MLP after pooling — buys you a place to do the contrastive stretching without deforming the representation the backbone learned. Some setups drop the head at inference and embed from the layer beneath it. I keep it, measure both, and let part three's numbers settle the argument. The model is the easy part precisely because you can measure it cleanly; that's what part three is for.
