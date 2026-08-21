The clean idea from part one was that decode is bandwidth-bound, so we should batch: run many requests through the same weight read and amortize the cost. The dirty reality is that requests do not arrive in a batch. They dribble in, one every few milliseconds, each one already halfway through a sentence someone is watching stream. Batching, done honestly, is not a throughput trick. It is a scheduling problem, and the scheduler is deciding whose latency to spend.

## Static batching is a trap

The first instinct is to wait: collect requests for a few milliseconds, form a batch, run it. This works beautifully in a benchmark and terribly in production, because a batch runs until its *longest* member finishes. If I have seven requests that want twenty tokens and one that wants two thousand, static batching chains all seven to the straggler. Seven users pay for one user's essay.

```d2
arrivals -> queue
queue -> batch
batch -> gpu: {shape: cylinder}
gpu -> batch: step
batch -> evict: finished seqs
evict -> queue: refill slots
```

The fix that changed serving is continuous batching: treat the batch as a set of slots, and at every decode step evict finished sequences and admit waiting ones. The batch is never "formed" and never "done" — it is a living roster.

## The number the scheduler is actually optimizing

Every step, the scheduler holds a batch of active sequences and must decide how many new requests to admit. Admit too many and prefill for the newcomers stalls the decode stream for everyone already going. The tension is between throughput, which grows with batch size $B$, and per-token latency, which also grows with $B$ once you are memory-bound. If a decode step costs roughly $t_{step}(B)$ and you serve $B$ tokens in it, throughput is $B / t_{step}(B)$ while each user feels $t_{step}(B)$ directly. You are choosing a point on that curve for a population, not a request.

There is also the interruption cost: admitting a new sequence means running its prefill, and a prefill for a long prompt is a compute spike dropped into the middle of everyone else's smooth decode. Good schedulers budget a token allowance per step and refuse to blow it, chunking long prefills across several steps instead.

## The loop, roughly

Here is the shape of a continuous-batching step in Rust — stripped down, but the eviction-then-admission ordering is the load-bearing part:

```rust
struct Scheduler {
    active: Vec<Seq>,
    waiting: VecDeque<Seq>,
    max_batch: usize,
    token_budget: usize,
}

impl Scheduler {
    fn step(&mut self, model: &Model) {
        // 1. Evict finished sequences first, freeing slots.
        self.active.retain(|s| !s.is_done());

        // 2. Admit waiting requests, but never exceed the prefill budget.
        let mut spent = 0;
        while self.active.len() < self.max_batch {
            match self.waiting.front() {
                Some(next) if spent + next.prompt_len <= self.token_budget => {
                    let seq = self.waiting.pop_front().unwrap();
                    spent += seq.prompt_len;
                    self.active.push(seq);
                }
                _ => break,
            }
        }

        // 3. One fused decode pass over the whole living roster.
        model.decode_batch(&mut self.active);
    }
}
```

Evict before you admit, or you leave slots cold for a full step. Budget the prefill, or one long prompt jitters every stream behind it. Continuous batching is not complicated code; it is a policy about whose milliseconds are cheap right now. The KV cache is what makes those slots expensive in the first place, and that is part three.
