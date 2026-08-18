---
title: "Batching is a scheduling problem"
description: "Once retrieval works, the next wall is latency — and most of the latency you can actually control turns out to be a question of scheduling, not hardware."
pubDate: 2025-09-18
author: "Shivam Chaudhary"
tags: ["Serving", "Systems"]
draft: false
series: "serving-demo"
seriesTitle: "Serving at speed"
seriesOrder: 1
seriesTotal: 5
---

The retrieval stack answers *what* comes back. This series is about *how fast* — and the uncomfortable truth that a surprising share of the latency budget is yours to lose or keep, long before you buy a bigger GPU.

Batching is where it starts. It looks like a throughput lever, but it is really a scheduling problem: how long are you willing to wait to gather a fuller batch, and what does that wait cost the reader who arrived first?

We will take that question apart over the next few parts. For now it is enough to see that "serve it faster" is not one decision but a stack of them.
