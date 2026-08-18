---
title: "Why my first vector store was a CSV"
description: "The cheapest retrieval system that could possibly work, and what it taught me before I reached for anything heavier."
pubDate: 2025-02-12
author: "Shivam Chaudhary"
tags: ["Retrieval", "Systems"]
draft: false
series: "retrieval-demo"
seriesTitle: "The retrieval stack"
seriesOrder: 1
seriesTotal: 3
---

Before the embeddings, before the index, before any of the machinery, there was a spreadsheet. One column of text, one column of vectors written out as strings, and a linear scan that was embarrassingly fast for the size of the problem I actually had.

The point of this first part is not the CSV. It is that the retrieval step deserves to be the last thing you make complicated, not the first. Most of what looks like a retrieval problem is a chunking problem wearing a costume.

We will build up from here — a real index next, then the drift that nobody warns you about — but the shape of the argument is set on day one: measure before you reach for the heavier tool.
