Priya asked me to write a guest part for the Serving at speed series, and my first instinct was to decline — I measure systems, I do not tune them, and the two disciplines talk past each other constantly. Then I reread the series and realized the whole thing is missing the part I would insist on before touching a single latency number. So here is my proposal for the part I would slot in: measurement, before optimization.

The argument is short. You cannot speed up what you have not defined, and "fast" is not a definition. Before anyone touches a kernel or a batch size, the series should force these commitments:

- Name the latency you mean — p50 hides the problem, p99 is where users live, and p999 is where they leave.
- State it end to end, from request received to last token flushed, not just model forward time.
- Fix the load it holds at, because a p99 without a concurrency number is a wish.
- Write down the quality floor you refuse to cross while chasing speed.

That last one is the part I care about most, and the part optimization series always omit. Every serving win I have audited traded something — precision, batch fairness, tail behavior — and the ones that shipped cleanly were the ones that measured the trade before making it. If Priya takes the part, that is the sentence I want it to leave readers with: speed you cannot measure against a quality floor is not a win, it is a bet you forgot to price.
