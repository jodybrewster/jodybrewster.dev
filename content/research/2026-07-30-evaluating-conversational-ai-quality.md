---
title: "Better is a statistical claim, not a vibe"
slug: evaluating-conversational-ai-quality
pubDate: 2026-07-30
pillar: evals
tags: [evaluation, agentic-systems, methodology]
description: "Most teams judge conversational AI by reading outputs and trusting the feeling. The alternative is error analysis, a calibrated judge, and a powered comparison."
publish: true
---

Ask a team how they know their assistant is getting better and you will usually get one of two answers. Either a benchmark number, or a shrug and some version of "it feels sharper since we rewrote the prompt." Both are the same answer wearing different clothes. Neither one survives the question that follows: better than what, by how much, and how confident are you?

The teams that actually improve their systems have something the others don't, and it isn't a smarter model or a better prompt. It's a maintained eval system: error analysis over real traces, a judge calibrated against human labels, and a comparison powered well enough to tell a real change from noise. The teams that stall tweak prompts and read outputs.

## Look at the data before you pick a metric

Hamel Husain's advice on this is unusually blunt for the field: "LOOK AT THE DATA… look at your logs/traces - start with 30 or so. Start categorizing the errors and issues you see. Keep looking… until you feel like you aren't learning anything new." His rule of thumb is at least 100 traces, stopping when roughly 20 in a row turn up no new failure category. He describes the LLM judge as "a nice 'hack' I use to trick people into carefully looking at their data," which is the most honest description of the technique I have read.

This inverts the usual order of operations. Most teams choose metrics first, from a vendor's list, and then go looking for failures the metrics can see. Error analysis says: find the failures, then build the metric that catches them. It produces a much smaller and much more useful eval suite. Husain puts the typical shape at two or three code-based evals and one or two LLM-based ones.

Ben Hylak's framing on howtoeval.com sharpens it into a test you can apply to your own instincts: "If you could ship with a 90% pass rate or a 99% pass rate, which would you choose? If your instinct is '99%, obviously,' you are still thinking like a benchmarker. If your first question is 'which 1% fails?', you are thinking like someone raising the floor." Product teams should be raising the floor. Benchmark scores belong to labs.

## Criteria drift is the part nobody plans for

The deepest finding here comes from Shreya Shankar and colleagues in "Who Validates the Validators?" They name a catch-22 at the centre of evaluation work: "to grade outputs, people need to externalize and define their evaluation criteria; however, the process of grading outputs helps them to define those very criteria."

You cannot fully specify what good looks like before you have seen a few hundred examples of bad. This means an eval suite is not a target you define once and then optimise against. It is a sensemaking process that keeps rewriting its own rubric, and any plan that treats criteria as fixed up front is planning for a system it does not yet understand.

I find this the single most useful thing to say out loud in a room where someone is asking for the acceptance criteria before the build starts.

## The judge is useful and it is also biased

LLM-as-judge is the only technique that scales, and its reliability is genuinely contested rather than settled. Zheng et al. reported that "strong LLM judges like GPT-4 can match both controlled and crowdsourced human preferences well, achieving over 80% agreement, the same level of agreement between humans." Khandelwal et al. showed that figure depends on methodology: "this discrepancy arises because they remove ties and inconsistent annotations… When ties and inconsistencies are retained, Zheng et al. (2023) report an approximately 60% agreement between LLMs and crowd-sourced humans, which is slightly better than random guessing."

So the honest position is Eugene Yan's: treat the judge as "an imperfect but scalable signal, useful for quick feedback or binary identification of issues." Not ground truth. Not a dashboard you trust unattended.

The known biases each have a known mitigation. Position bias, fixed by randomising or swapping order. Verbosity bias, fixed by controlling for length and separating correctness from style. Self-preference bias, where a judge scores its own family's output higher by something like 10-25%, fixed by cross-model judging. Format bias. And calibration drift, which is the one that actually bites in production: the same rubric returns different scores after a judge model version bump, and nothing in your pipeline tells you.

Calibrate against humans with real numbers. Cohen's kappa for two labellers, Krippendorff's alpha for three or more. Under 0.4 on inter-annotator agreement means the rubric is ambiguous and needs rewriting, not that your labellers are bad. Judge-to-human above 0.6 is acceptable for production, above 0.8 is strong, below 0.5 is advisory only.

The cautionary example in the source material is worth keeping: a team ships a GPT-4 groundedness judge scoring GPT-4 outputs, the dashboard glows green for three months, and then a domain expert reads 50 outputs and the expert-judge kappa comes back at 0.31. Family bias plus a judge that under-penalises fluent hallucination. Three months of confident, measured, wrong.

## Containment is not resolution

The metric distinctions matter more than the metric values, because the wrong one will look like success while the product fails.

Deflection is the broadest and least meaningful: what fraction of contacts never reached a human. A 90% deflection rate tells you almost nothing about whether anyone was helped. Containment is channel-level, conversations that stayed automated, and it counts a frustrated abandonment as a win. Resolution is whether the issue was actually solved, and it is the only one that should run the operation. The good measurement practice is to reclassify a session as unresolved if the customer comes back on the same issue within 24 hours.

Follow the incentive design here, because it is instructive. Intercom's Fin charges $0.99 per resolution, billed once per conversation, which means the vendor earns nothing on an escalation. Zendesk now separates "contained" from billed "verified" resolutions. When a vendor voluntarily stops billing for the easy metric, that tells you which metric was load-bearing.

Layer them, and keep leading separate from lagging. Groundedness, refusal rate, retrieval recall and tool-call accuracy move immediately and predict trouble. CSAT, repeat-contact rate and handle time confirm business impact and lag by weeks. The operating rule: if containment climbs while every partner metric holds, the gain is real. If containment climbs while CSAT or repeat contacts move the wrong way, stop and fix resolution.

The failure mode I have seen most often in RAG systems hides in exactly this gap. A legal assistant scores 0.91 on faithfulness and still misses statutes one time in six, because context recall is 0.62. The generator answers coherently from partial context, faithfulness stays high, and no generation-stage metric ever surfaces the retrieval regression. Pair retrieval metrics and generation metrics on the same trace or you will not see it.

## Proving it moved

Non-determinism is what makes this a statistics problem rather than a testing problem. Anthropic runs multiple trials per task and reports pass@k, the likelihood of at least one success in k attempts, alongside pass^k, the probability that all k succeed. Their example: a 75% per-trial success rate over three trials gives (0.75)³ ≈ 42% chance of passing all three. At k=1 the two are identical. By k=10 they tell opposite stories. For a customer-facing agent, consistency is the product, so pass^k is the number that matters.

Sample size before the test, not after. For a continuous score, roughly 16 × σ² / MDE² per arm at 80% power. A groundedness judge with σ=0.18 needs about 324 paired examples per arm to detect a 0.04 shift, and about 1,296 to detect 0.02. The cheapest lever is not more data, it is reducing σ with a better-calibrated judge or a matched-pair design.

Then ship it through the ladder rather than at once: shadow mode, canary at 1-5%, and only then a full rollout. Stratify the canary by cohort, because a uniform 5% on a tenant-skewed distribution routes most of your candidate traffic to whale users. Gate on per-segment percentiles rather than aggregate means, or the sub-route sitting at 0.62 disappears inside an overall 0.91.

Anthropic's own discipline is the right note to end on: "we do not take eval scores at face value until someone digs into the details of the eval and reads some transcripts." The number is the beginning of the argument, not the end of it.
