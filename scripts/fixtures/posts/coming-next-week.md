This is a placeholder with a purpose: I want to see how a scheduled, not-yet-written post behaves in the system before the real thing lands. So consider this a table of contents for next week, published a little early and on purpose.

Here is what I am planning to actually write, roughly in order:

1. **A load-test post-mortem** — the one where continuous batching looked great until a single 8k-token prompt jittered every stream behind it, and what the scheduler fix actually was.
2. **Quantized KV, measured honestly** — not "it's smaller" but where 8-bit keys and values start costing accuracy on long context, with the eval numbers.
3. **Prefix sharing in practice** — how much HBM a shared system prompt really buys back once you account for the block-table bookkeeping.

If you are reading this after the dates have passed and the links are still dead, that is itself the useful signal: it means the scheduling around publication needs the same attention I keep demanding of the serving path. See you next week, assuming the queue drains on time.
