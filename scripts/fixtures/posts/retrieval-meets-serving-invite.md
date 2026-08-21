This one's a stub. I (Shivam) started roughing out a companion piece to the seam post — the operational side, what actually pages you at 3am — and got about a third of the way before realizing it wants Mira's retrieval eyes on it more than my serving ones. Leaving the skeleton here so she can pick it up rather than me guessing.

## What this draft still owes

- A real incident, not a hypothetical: the day the index rebuild silently halved recall and no latency graph moved.
- The distinction between a retriever that's *slow* and one that's *wrong* — they need different alerts and we currently have one.
- Whether staleness belongs in the cache TTL table from the last post or deserves its own treatment.
- Mira's take on shadow-indexing before a cutover. I have opinions; hers are load-bearing.

## Open questions for Mira

1. Do we measure recall in prod at all, or only in eval? If only eval, that's the post.
2. Is there a version of this that doesn't require a labeled set to notice a regression?
3. Should this be one piece with the seam post, or its own thing?

Not ready to publish. Handing it over.
