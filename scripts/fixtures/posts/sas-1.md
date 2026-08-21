I want to start this series by refusing the usual framing. Serving a large model is not "make the GPU go fast." The GPU is already fast. The problem is that we are trying to keep thousands of half-finished conversations alive on a fixed slab of silicon, each one arriving at a different time, wanting a different number of tokens, and all of them sharing the same memory. Latency, at this scale, is a resource-contention story wearing a performance costume.

## Two clocks that don't agree

Every inference request lives under two clocks. The first is time-to-first-token: how long before the user sees anything. That is dominated by the prefill pass, where we process the entire prompt at once. The second is inter-token latency: the pace of the stream after that, governed by decode, where we generate one token at a time. These two phases have opposite personalities. Prefill is compute-bound and loves big matrix multiplies. Decode is memory-bandwidth-bound and spends most of its life waiting to read weights and cache.

```d2
request -> prefill
prefill -> decode
decode -> decode: one token at a time
decode -> done
prefill: {label: "compute-bound"}
decode: {label: "bandwidth-bound"}
```

The mistake I see teams make is optimizing one clock and shipping a regression on the other. Cut prefill latency by raising batch size, and you can lengthen every decode step for everyone already streaming. The scheduler is the referee between these two, and part four of my own past mistakes lives right here.

## Why the hardware makes this hard

Decode reads the full weight matrix to produce a single token. That means throughput is capped not by how many FLOPs the chip can do but by how fast it can move bytes. A rough operational number I carry around:

- A decode step touches on the order of the entire parameter set in memory reads.
- The arithmetic per token is tiny by comparison.
- So the chip is idle-ish, waiting on HBM, unless we give it more work to overlap.

"More work to overlap" is the entire game, and it is why batching exists. But batching is not free, which is the cliffhanger for part two.

## A first look in code

Here is the naive server, the one everybody writes first, and the one that will fall over the moment two requests arrive within a few milliseconds of each other:

```python
class NaiveServer:
    def __init__(self, model):
        self.model = model

    def generate(self, prompt, max_tokens=256):
        # Prefill: process the whole prompt at once.
        state = self.model.prefill(prompt)
        tokens = []
        # Decode: one forward pass per token, serially.
        for _ in range(max_tokens):
            tok = self.model.decode_step(state)
            if tok == self.model.eos:
                break
            tokens.append(tok)
        return tokens

    def handle(self, request):
        # One request monopolizes the GPU end to end. No sharing.
        return self.generate(request.prompt, request.max_tokens)
```

Everything wrong with serving is visible here. A single request holds the device for its entire lifetime, decode runs at batch size one so the chip spends its life waiting on memory, and a slow generator behind you means you wait for all of it. The rest of this series is a sequence of moves to fix exactly these three sins: batching, memory, and speculation. But first you have to believe the problem is scheduling and contention, not raw speed. That belief is the whole point of part one.
