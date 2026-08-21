Every text pipeline claims to be Unicode-clean until you hand it a title like this one. The bugs don't live in the ASCII path; they live in the seams — where a byte offset is mistaken for a character offset, where `café` round-trips through NFC and NFD into two different strings that no longer compare equal, where an emoji is one grapheme but two UTF-16 code units and your truncation lands in the middle of it. I test my embedding preprocessor against exactly the strings that break naive code, and I keep them in the corpus on purpose.

The cases I insist on covering, before anything ships:

- **Non-Latin scripts** — 日本語 must tokenize as text, not get stripped as "non-word characters." Same for Cyrillic, Arabic, and Devanagari.
- **Combining marks** — `café` written as `cafe` + combining acute must normalize to match `café` written with a precomposed é. NFC before hashing, always.
- **Emoji and ZWJ sequences** — 🚀 is fine, but 👩‍💻 is a woman + zero-width-joiner + laptop, and a byte-naive truncation splits it into garbage.
- **Mixed direction and mixed language** — a title in español next to 日本語 next to English should embed as one string, not silently language-detect and drop the minority script.

Here is the normalization pass, and it stays boring on purpose. The comment is in Japanese to make the point that source files travel too.

```python
import unicodedata

def normalize_for_embedding(text: str) -> str:
    # 埋め込み前に必ずNFCへ正規化する（結合文字のブレを防ぐ）
    text = unicodedata.normalize("NFC", text)
    # count in grapheme-safe code points, never in bytes
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Cc")
    return text.strip()

for s in ["café", "日本語", "español", "launch 🚀", "👩‍💻"]:
    out = normalize_for_embedding(s)
    assert out == unicodedata.normalize("NFC", out)
    print(repr(out), len(out))
```

If that loop runs clean and the lengths match your grapheme expectations, the tokenizer downstream will too. The whole trick is refusing to measure text in bytes when you mean characters, and refusing to measure in characters when you mean graphemes. café, 日本語, and 🚀 are not edge cases. They're Tuesday.
