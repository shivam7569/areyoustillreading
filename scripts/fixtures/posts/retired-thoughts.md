Some things I write down are not for anyone. They're for the version of me six months out who will otherwise repeat the mistake. This is one of those pages — unlisted, unfinished, kept because deleting it would delete the lesson with it.

I once spent three weeks convinced a retrieval regression was a model problem. New checkpoint, worse recall, obvious culprit. It was not the model. It was a normalization change upstream that had quietly started lowercasing before embedding, and the old index had been built cased. Two different spaces, compared as if they were one.

> The bug is almost never where the metric moved. The metric moves downstream of the bug, which is why you keep looking in the wrong place.
> — a note to myself, kept unlisted

I'm leaving this here without a conclusion because it doesn't have one. The point isn't the story. The point is that when a number changes, the first question is not "what did the model do," it's "what did I change about the inputs." I'll forget that again. This page is here for when I do.
