Attention gets described in one of two ways: a hand-wave about "tokens looking at each other," or a wall of tensor indices that no one reads twice. I want the middle path — slow, explicit, and small enough to hold in your head. I care about attention because it is the single operation whose cost I have to defend on every serving invoice, and you cannot budget what you cannot write down.

## The core operation

Start with one query vector and one set of keys and values. For a query $q \in \mathbb{R}^d$ and keys $k_1, \dots, k_n$, attention scores each key by a dot product, scales it, softmaxes across the keys, and takes a weighted sum of the values. The scaling by $\sqrt{d}$ is not decorative — without it the dot products grow with $d$, the softmax saturates, and the gradients go flat.

$$\mathrm{Attention}(Q, K, V) = \mathrm{softmax}\!\left(\frac{QK^\top}{\sqrt{d}}\right)V$$

Written per-row, the weight the query puts on key $j$ is

$$\alpha_j = \frac{\exp(q \cdot k_j / \sqrt{d})}{\sum_{m=1}^{n} \exp(q \cdot k_m / \sqrt{d})}, \qquad \mathrm{out} = \sum_{j=1}^{n} \alpha_j\, v_j.$$

That is the whole thing. Everything else — multiple heads, causal masks, KV caches — is bookkeeping around this sum.

## What each part costs

Before you touch code, know where the money goes:

- The $QK^\top$ product is $O(n^2 d)$ — quadratic in sequence length. This is the term that ruins long-context economics.
- The softmax is $O(n^2)$ elements to normalize, cheap in FLOPs but memory-bandwidth bound.
- The weighted sum $\alpha V$ is another $O(n^2 d)$.
- The intermediate scores matrix is $O(n^2)$ in memory — the reason naive attention runs out of HBM long before it runs out of compute.

### Multiple heads

With $h$ heads, you split $d$ into $h$ subspaces of width $d/h$, run the same operation independently, and concatenate. It does not change the asymptotics; it changes what the model can attend to in parallel.

## Writing it out

Here is the single-head version with no framework magic, so the indices have nowhere to hide:

```python
import numpy as np

def attention(Q, K, V, mask=None):
    # Q: (n, d), K: (m, d), V: (m, d_v)
    d = Q.shape[-1]
    scores = Q @ K.T / np.sqrt(d)          # (n, m)
    if mask is not None:
        scores = np.where(mask, scores, -np.inf)
    scores = scores - scores.max(axis=-1, keepdims=True)  # stabilize
    weights = np.exp(scores)
    weights /= weights.sum(axis=-1, keepdims=True)         # softmax
    return weights @ V                     # (n, d_v)
```

The `- scores.max(...)` line is the same trick that lets flash-attention run the softmax in a single streaming pass: subtract the running max, and no exponent ever overflows. Once you have written attention this way, the fused kernels stop being mysterious. They are this function, tiled so the $O(n^2)$ scores never fully touch memory.
