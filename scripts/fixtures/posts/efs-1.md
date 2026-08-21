The model gets all the attention and almost none of the credit. When people ask me why an embedding space works or doesn't, they expect me to point at an architecture. I point at the training pairs. The geometry you get out is a faithful cast of the supervision you put in, and if the supervision is careless, no amount of hidden dimensions will save you. This is part one of building an embedding model from scratch, and I'm spending it entirely on the data, because the data decides.

## What a positive pair actually claims

Every positive pair you feed a contrastive objective is an assertion: *these two things should be close.* That assertion propagates. If you tell the model that a question and its accepted answer are a positive pair, you are teaching "close" to mean "topically relevant." If you pair a sentence with its own back-translation, you are teaching "close" to mean "paraphrase." These are different spaces. People blur them and then wonder why retrieval returns fluent restatements instead of answers.

So before any code, I write down what I want "near" to mean, in one sentence, and I refuse to mix pair types that contradict it.

## Sources, ranked by how much I trust them

- **Behavioral pairs** — a click, a purchase, a co-read. Noisy per-instance, unbeatable in aggregate, and free of annotator bias because no annotator was involved.
- **Structural pairs** — title and abstract, question and accepted answer, a heading and its section. Cheap, plentiful, and honest about topical proximity.
- **Editorial pairs** — human-labeled duplicates or entailment. Highest precision, lowest volume, and the first thing to run dry.
- **Synthetic pairs** — an LLM writing a query for a passage. Useful to fill gaps, dangerous as a base, because the model's blind spots become your training distribution.

## The negatives are where models are won

Positives set the direction; negatives set the resolution. Random negatives are almost free and almost useless past the first epoch — the model learns to separate "database index" from "a photo of a cat" in an afternoon and then coasts. The hard negatives are the ones that look right and aren't, and mining them is most of the real work.

```python
import numpy as np

def mine_hard_negatives(query_emb, corpus_emb, positives, k=5, margin=0.02):
    """Return in-batch hard negatives: high similarity, not a known positive."""
    sims = corpus_emb @ query_emb  # cosine, assuming L2-normalized rows
    order = np.argsort(-sims)
    negs = []
    for idx in order:
        if idx in positives:
            continue
        # skip near-duplicates of the positive to avoid false negatives
        if sims[idx] > sims[positives[0]] - margin:
            continue
        negs.append(int(idx))
        if len(negs) == k:
            break
    return negs
```

That `margin` check is not a nicety. Skip it and you will mine your own positives as negatives — a passage that answers the query even better than the labeled one — and spend the whole run teaching the model to push apart things that belong together.

## A cleaning pass that pays for itself

Before a single batch, I run the corpus through the same steps every time, because the failure modes are boringly consistent.

1. **Dedup near-identical texts** — exact and near (MinHash). Duplicates in different splits leak your test set into training.
2. **Drop degenerate pairs** — anything where query and positive are the same string, or differ only by whitespace.
3. **Length-balance** — cap the ratio of long to short so the model doesn't learn that "long" means "relevant."
4. **Language-tag and stratify** — mixed-language corpora silently collapse into a language classifier if you don't balance them.
5. **Hold out by source, not by row** — so evaluation measures generalization, not memorization of one forum's phrasing.

None of this is glamorous, and all of it moves the recall number more than swapping the backbone will. Part two is the model, and you'll see why I call it the easy part.
