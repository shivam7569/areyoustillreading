People treat the tokenizer as plumbing they never have to look at, right up until a prompt that should fit in the context window mysteriously doesn't. The tokenizer is not a detail. It is the units your model thinks in, and its quirks propagate straight into your latency and your bill.

The thing worth internalizing is that token count is not proportional to character count, and the ratio swings wildly by content. English prose runs around four characters per token. A blob of JSON with lots of punctuation, or a language the tokenizer wasn't trained to compress, can run two or worse. Here is the measurement I actually run before trusting any context budget:

```python
from collections import Counter

def token_stats(text: str, enc) -> dict:
    ids = enc.encode(text)
    chars = len(text)
    return {
        "tokens": len(ids),
        "chars": chars,
        "chars_per_token": round(chars / max(len(ids), 1), 2),
        "unique": len(Counter(ids)),
    }

for sample in ("plain english sentence", '{"k": [1,2,3], "v": null}'):
    print(sample[:20], token_stats(sample, enc))
```

The `chars_per_token` field is the one I watch. When it dips below three, some part of my input is fighting the vocabulary, and that is my cue to look — usually it's escaped whitespace, base64, or a non-Latin script paying a per-character tax. Measure it on your real traffic, not on the tidy English you used to size the budget.
