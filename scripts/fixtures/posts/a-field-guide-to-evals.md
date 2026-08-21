I have watched more evaluation efforts die of vagueness than of difficulty. The hard part of an eval is almost never the statistics; it is deciding, in advance and in writing, what you are willing to be wrong about. This is a field guide in the literal sense — a way to identify the eval you are actually looking at, tell it apart from the ones it resembles, and know what it can and cannot tell you before you trust it with a launch.

## The four families

Every eval I have run falls into one of four families, and confusing them is the most common failure mode I see.

- **Reference-based.** You have gold answers and score proximity to them. Cheap, repeatable, and blind to any correct answer you did not anticipate.
- **Model-graded.** A judge model scores the output against a rubric. Scales beautifully, and inherits every bias of the judge — including a fondness for outputs that sound like itself.
- **Human-graded.** People rate outputs. The gold standard for judgment, the worst for throughput and consistency.
- **Behavioral.** You measure what users actually did downstream. The only family that touches reality, and the slowest and most confounded.

The families are not ranked. They are tools for different questions, and the guide below is about matching the tool to the question.

## Choosing between them

| Family | Cost | Speed | Trust | Catches the unexpected |
| --- | --- | --- | --- | --- |
| Reference-based | Low | Fast | Medium | No |
| Model-graded | Low-medium | Fast | Medium-low | Sometimes |
| Human-graded | High | Slow | High | Yes |
| Behavioral | Medium | Slow | High | Yes |

Read the table as a sequence, not a menu. Reference-based evals filter thousands of candidates cheaply. Model-graded evals catch the ones that pass the letter of the reference but fail its spirit. Human grading adjudicates the disputes the first two cannot. Behavioral confirms, in production, that any of it mattered.

## The statistics you cannot skip

Every eval score is an estimate, and an estimate without an interval is a rumor. For an accuracy $\hat{p}$ measured on $n$ examples, the standard error is $\sqrt{\hat{p}(1-\hat{p})/n}$, and the width of your confidence interval scales as $1/\sqrt{n}$. That $1/\sqrt{n}$ is unforgiving: to halve your uncertainty you must quadruple your test set. I have killed more than one "clear win" of two points measured on three hundred examples, because the interval was wider than the effect.

The second number people skip is agreement. If your human graders agree only $70\%$ of the time, no metric downstream of them can be trusted past that ceiling. Measure inter-rater agreement before you measure the model; the graders' noise floor is your metric's noise floor.

## The traps

A few failure modes recur often enough that I check for them by reflex:

1. **Contamination.** Your test set leaked into training. The score is now a memorization test wearing a generalization costume.
2. **The judge that flatters.** A model-graded eval where the judge and the candidate share a family will reward stylistic kinship over correctness.
3. **Metric saturation.** Everything scores $0.97$, so the metric can no longer distinguish systems. You are measuring the ceiling, not the model.
4. **Slice blindness.** The aggregate improved while the subgroup you care about regressed, and the mean absorbed it silently.
5. **The frozen set.** Your eval was representative in March and the traffic moved in June. A stale eval is confidently wrong.

## What a good eval actually is

After all the machinery, the thing that separates a real eval from theater is modest and unglamorous.

> A good eval is one where you wrote down what would change your mind before you looked at the result.
> — the only definition I have found that survives contact with a launch review

That is the discipline. Not the fanciest metric, not the largest test set — the pre-commitment. Decide the threshold, the slices, the interval, and the failure you refuse to ship, all before the numbers arrive. An eval built afterward, to explain a result you already have, is not an evaluation. It is a defense.

## The one-page checklist

When someone brings me an eval to bless, I ask six things, in order:

- What decision does this gate, and what would flip it?
- Which family is it, and does that family catch the failure you fear?
- How many examples, and how wide is the interval?
- What slices did you break it out by?
- When was the test set last refreshed against real traffic?
- If the judge is a model, who audits the judge?

If the answers come easily, the eval is probably sound. If they come slowly, the eval is measuring convenience. In seven years I have not found a shortcut past those six questions, and I have stopped looking for one.
