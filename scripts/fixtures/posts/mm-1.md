Every metric you report is a claim about what the model is for. That is the sentence I open with in design reviews, and it lands badly, because most teams treat the metric as a thermometer — a neutral reading of an external truth. It is not. A metric is a hypothesis about which differences between systems ought to matter, wearing the costume of a measurement.

## The metric encodes a preference

Consider recall@10 on a retrieval system. Choosing it says, explicitly: I believe the reader looks at ten results, I believe position within those ten is irrelevant, and I believe finding one relevant document is as good as finding five. Every one of those is a product decision. If your reranker changes the ordering inside the top ten and recall@10 does not move, that is not the metric being stable — it is the metric being blind to the thing you just spent a quarter building.

So before adopting any number, I make the team write down what it assumes:

- What user action does the metric stand in for?
- What kind of improvement would leave it unchanged?
- What kind of regression would leave it unchanged?
- Who is harmed by an error the metric averages away?

The third and fourth questions are where the bodies are. A metric that cannot regress on the failure you fear is not measuring safety; it is manufacturing comfort.

## Averages hide the hypothesis

A mean is a hypothesis that every example is exchangeable. When I report accuracy of $0.91$ across a corpus, I am asserting that the eight in a hundred wrong answers are drawn uniformly — that no subgroup carries them. That is almost never true. The honest move is to state the aggregate and its intended reach: $\bar{x} = \frac{1}{n}\sum_i x_i$ is a summary of this population under this weighting, and it makes no promise about the tail or about any slice you did not condition on.

> If you can't state the decision the number is supposed to change, you don't have a metric. You have a mascot.
> — a note I keep pinned above my desk

## Treat it like a hypothesis, then

Once you admit the metric is a hypothesis, the workflow follows:

1. Write the assumption down in one sentence before you look at any scores.
2. Construct the case that would move the metric but not the user, and the case that would move the user but not the metric.
3. If either case is realistic, the metric is wrong for this decision — fix it before you optimize against it.
4. Only then let it gate a launch.

Most bad launches I have reviewed were not measurement failures. The instrument worked perfectly. It measured a hypothesis nobody had agreed to.
