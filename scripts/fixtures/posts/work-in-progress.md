This is a draft. I'm parking it in public so I stop losing the thread between sessions, but none of it is finished and some of it is probably wrong. Read it as notes, not as a claim.

The thing I'm circling is why our rerank cache hit rate cratered after the last index rebuild. Rough state of my thinking:

- Cache keys include the document `updated_at`, so a full rebuild invalidates everything at once — obvious in hindsight.
- But the recovery curve is too slow. A week later we're still under the old steady-state hit rate. Why?
- Suspect the query distribution shifted at the same time, so I'm confounding two changes. Need to separate them.

Still to do:

1. Pull hit-rate by query-frequency bucket, before and after — is it the head or the tail that's cold?
2. Check whether the rebuild changed candidate ordering enough to change rerank inputs for the *same* query.
3. Write the actual explanation here once I have one.

(Placeholder for the conclusion. I don't have it yet. Leaving this here so future-me remembers there was a question.)
