Speculative decoding gets pitched as free speed, and I want to give it a fairer, more suspicious hearing than that. The core trick is real and clever: decode is bandwidth-bound and processes one token per expensive weight read, so what if we guessed several tokens ahead cheaply and then verified them all in a single pass of the big model? When the guesses are right, we got multiple tokens for the price of one forward pass. When they're wrong, we throw the guesses away.

## The mechanism

A small, fast draft model proposes $k$ tokens. The large target model runs one forward pass over all $k$ proposals at once — the same operation as prefill, which the hardware loves — and checks each against what it would have produced. A clever acceptance rule keeps the output distribution exactly equal to sampling from the target model alone, so this is lossless: the text is identical in distribution to not speculating at all.

```d2
prompt -> draft: propose k tokens
draft -> target: verify all k
target -> accept: longest valid prefix
accept -> emit
target -> reject: resample one
reject -> emit
emit -> draft: continue
draft: {shape: hexagon}
target: {shape: cylinder}
```

The honest part is in the words "longest valid prefix." You do not get $k$ tokens per step. You get however many the target agrees with before the first disagreement, then one corrected token, then you start over.

## Where the speedup actually comes from — and goes

The acceptance rate is everything. If the draft agrees with the target often, you routinely accept several tokens per verification pass and the effective speedup is large. If the draft is a poor stand-in — different domain, different temperature, hard reasoning — acceptance collapses and you have simply added a draft model's cost to every step for nothing. The break-even is real and it is not always on your side.

> Speculative decoding doesn't make the model faster. It makes being right cheap and being wrong slightly expensive. Your speedup is a bet on how often the draft is right.

## What verification looks like

Here is the acceptance loop, simplified but faithful to the shape that keeps it lossless:

```python
def speculative_step(draft, target, state, k=4):
    # Draft proposes k tokens cheaply, tracking its own probabilities.
    proposals, q = draft.propose(state, k)

    # Target verifies all k in ONE batched forward pass.
    p = target.logprobs(state, proposals)  # p[i] = target prob of proposals[i]

    accepted = []
    for i, tok in enumerate(proposals):
        # Standard acceptance test keeps the output = target's distribution.
        ratio = min(1.0, p[i][tok] / q[i][tok])
        if random() < ratio:
            accepted.append(tok)
        else:
            # Reject here: resample one token from the corrected residual
            # distribution and stop — the rest of the guesses are discarded.
            accepted.append(sample_residual(p[i], q[i]))
            return accepted
    # All k accepted: sample one bonus token from the target for free.
    accepted.append(sample(p[k]))
    return accepted
```

Notice you can accept anywhere from one token (immediate reject plus resample) to $k+1$ (all accepted plus the bonus). The average is what you measure, and it depends entirely on how well-matched your draft is.

## When I actually reach for it

I turn it on when the draft can be genuinely good and cheap — a distilled version of the same model, or the model's own early layers — and when I am latency-bound at low batch size, where the extra compute of verification is basically free because the chip was waiting on memory anyway. I leave it off at high batch, where I am already compute-bound and verification's extra FLOPs directly steal from everyone else. Speculative decoding is honest speed, but it is conditional speed, and the condition is a draft model you can trust on your own traffic.
