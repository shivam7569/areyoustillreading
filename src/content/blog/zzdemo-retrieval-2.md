---
title: "The index is not the memory"
description: "An index tells you where things are. It does not tell you what they mean — and confusing the two is where retrieval quietly starts to lie."
pubDate: 2025-05-03
author: "Shivam Chaudhary"
tags: ["Retrieval", "Systems"]
draft: false
series: "retrieval-demo"
seriesTitle: "The retrieval stack"
seriesOrder: 2
---

Having outgrown the spreadsheet, the temptation is to treat the shiny new index as if it were memory. It is not. An index is a filing system with opinions about distance, and those opinions are only as good as the embeddings you fed it.

This part is about the gap between "I can find the nearest vectors" and "I found the right passage." They are not the same claim, and the difference is exactly where a demo that dazzles turns into a system that disappoints.

That gap is the whole reason the next part exists — and why, a series later, the whole field comes back to evaluation.
