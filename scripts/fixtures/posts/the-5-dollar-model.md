Every few months someone announces they trained a frontier-competitive model for the price of a sandwich, and the number does something useful: it tells you exactly which line item they left out. The $5 figure is almost always the marginal cost of one training run's GPU-hours, quoted as if the data pipeline, the failed runs, the salaries, and the eval harness were acts of nature rather than the actual budget.

> The cheapest number in any model announcement is the one they chose to publish.
> — a thing I say too often

I am writing the title with a literal dollar sign and percent — "the $5 model" at "100% real" — partly as a joke and partly because it's a live test. Characters like `$`, `%`, `"`, `<`, and `>` are exactly the ones that get mangled somewhere between the editor, the renderer, and the HTML. If the title above shows those glyphs intact rather than an escaped `&lt;` or a stray backslash, the escaping worked; if not, you're looking at the bug.

The honest way to price a run is to not trust the headline and add up the whole ledger yourself. Here is the back-of-envelope I use, GPU-hours times the real rented rate, and then the multiplier for everything the headline dropped:

```bash
#!/usr/bin/env bash
# rough all-in cost of a training run
gpu_hours=1200
rate_per_hour=2.50        # on-demand, not the spot price in the press release
compute=$(echo "$gpu_hours * $rate_per_hour" | bc)

# headline usually reports 'compute' and stops here.
# the real bill: failed runs, data, eval, people.
overhead_multiplier=6
total=$(echo "$compute * $overhead_multiplier" | bc)

printf 'compute only: $%s\n' "$compute"
printf 'all-in (x%s): $%s\n' "$overhead_multiplier" "$total"
```

Run that and the $3,000 compute line becomes an $18,000 project, and the $18,000 project is still ignoring the six months of infrastructure that made the run possible at all. The five-dollar model is real in the same way a $5 airfare is real: technically quoted, practically a fiction.
