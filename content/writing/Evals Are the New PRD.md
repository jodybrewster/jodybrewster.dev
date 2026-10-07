---
title: "Evals are the new PRD"
date: 2026-10-07
description: "When a model sits at the center of a product, the user's need lives in a set of examples it passes or fails. What that means in practice."
tags:
  - AI
  - Product
  - Evaluation
pillar: Product Engineering
status: published
---

For a long time the product requirements document was where a user's need went to become work.
When the product is a model, or has one at its center, that job is moving somewhere else.
The need now lives in a set of examples the model either passes or fails.

Take a complaint every team building on models has heard: "it doesn't follow instructions."
It is a real signal with no direction in it.
Go back to the people saying it and ask for the exact prompt, the exact response and what they expected instead.
The complaint usually shrinks to one or two concrete failures, such as output in the wrong format or a constraint dropped halfway through a long answer.
Write thirty or forty examples of that failure, each with the answer you expected.
That is an eval.
Run it on every release and you will know the moment that failure comes back.

It still strikes me how fundamental this is.
I've seen it again and again in my own work: you have to keep your bearings.
Know your KPIs, know your end goals and the outcomes you're after and keep checking yourself against them.
That translates just as easily to your users' goals and the outcomes they want.

<figure class="essay-figure"><img src="/images/articles/evals-are-the-new-prd-bearings.webp" alt="Ink drawing of a hiking compass resting on a folded trail map, a pencilled route checked off along the way." width="1536" height="1024" loading="lazy" decoding="async" /></figure>

## What an eval is

An eval is a test for behavior that has no single right answer.
It is a set of inputs that look like what people actually ask, each paired with a description of a good result.
Sometimes that is an exact answer.
More often it is a rule the answer has to follow or a rubric it is judged against.

Something then does the grading.
Code works when the rule is mechanical, such as valid JSON or a link that points at a real page.
A person is slower and still the best judge of quality.
Another model can grade against the same rubric at scale, as long as you check its grades against a sample a person has marked.

The result is a score, usually the share of cases that passed.
Models are not fully deterministic.
Run each case a few times and treat the score as a range, because with forty cases one case flipping is noise.
What matters is how the score moves after you change something.

Verso, the chat on this site, has a small set like this.
One case asks how the Lennar maps replaced the old process and passes only if the answer comes from that project's page.
Another asks for a client's confidential budget and passes only if Verso refuses.
Neither has an exact expected answer.
Both are easy to judge.

## What it replaces

A PRD does several jobs.
It explains why the work matters and who it is for, sets the scope and names constraints like speed, cost and what must never be stored.
It also says what done looks like.

That last part is the one that goes stale.
It gets approved and then left alone while the product moves on.
Six months later nobody can tell which of its promises still hold.
An eval states the same intent in a form that keeps checking.
It asks the question again on every release.

So the title overstates it a little.
The why, the who and the constraints still need writing down.
What the eval replaces is the definition of done, the part that was always supposed to be checked and rarely was.
It also settles arguments better than prose does, because a team can disagree about a concrete case far more usefully than about a paragraph of intent.

## Protecting what you built

The most common reason to have an eval is change.
An answer comes out of a system: the model, its prompt, the context it retrieves and the tools it can call.
Change any one of them and behavior shifts somewhere you weren't looking.
A new model, a prompt edit meant to fix one answer or a new page in the corpus can each break something that used to work.
A system prompt has no compiler.
The eval set is how you find out what moved before your users do.

When the model takes actions, an eval needs a partner.
An eval measures how often the model gets something right across a set of cases before you ship.
A guardrail is code that checks every answer in production and refuses the bad ones.
Verso can only show a card for a page that exists.
It keeps a quote only if those exact words appear on the page.
That guardrail means a visitor never sees an invented page.
An eval would tell me how often the model tries to invent one, which is what says whether the prompt is working.
A rule in a prompt is a suggestion.
Only a rule in code is enforced.

Cost and speed belong in the same picture.
A cheaper model only saves money if it passes the same set.
Record latency, cost per answer and refusal rate next to the pass rate, because a model that got cheaper by declining hard questions has not got better.

<figure class="essay-figure"><img src="/images/articles/evals-are-the-new-prd-gauge.webp" alt="Ink drawing of a tray of identical bolts, one standing on the bench with a ring gauge around its thread and two set aside." width="1536" height="1024" loading="lazy" decoding="async" /></figure>

## Protecting what the user came for

Some outcomes matter because they never happen: a leaked confidential detail, an invented quote, a confident answer to a question nobody can answer.
Real usage rarely contains these until the day it does.
They have to be written on purpose.
A good set needs the opposite kind of case too.
An eval made only of failures rewards a model that refuses everything.

Users also change.
A set built at launch describes launch-day users.
Over time people ask different questions in different words.
Reading conversations is how you notice.
New cases are how you catch up.
An eval set usually outlives the conversations it came from.
A case drawn from a conversation gets written in my own words and never copied from the visitor's.

The hardest case is when the outcome is bigger than any single answer.
Verso's job is to give a visitor an honest sense of what working with me is like.
Accurate answers are only part of that.
No single question can test it.
That is where KPIs come in, telling you whether the outcome moved.
The eval tells you whether the part you control still behaves.
When a KPI drops, that lets you rule your own release in or out.
You need both to keep your bearings.

## Making it stick

An eval only helps if it runs without anyone remembering to run it.
The cases live in the repo next to the prompt they test, run on every change and block a release when the pass rate falls below an agreed line.
A case that passes every time still belongs in the suite, because a solved problem is the one nobody is watching.

There is one trap.
Tune a prompt against the same forty cases long enough and it learns those cases instead of the problem.
Keep some cases back that you never tune against and trust the score on those.

## Where I am with this

I build products around models and I have done about half of this.
Verso's deterministic parts, like its routing, card lookups and link checks, have unit tests that never call the model.
What has no score is the model's own judgment.
The questions I described earlier sit in a table in its evaluation doc.
I run them by hand after changing the prompt or the corpus.
They are eval cases without the eval.
I know where the bearings should be and I am still checking them by eye.

## The job search that measured the wrong things

The clearest example is my own job search.
Over the summer I built JobbyJob, a system that pulls new postings every night, scores them, queues applications and runs mock interviews by voice.
By September it had tracked 1,547 postings from seven sources and sent 216 applications, with a peak of 18 in one day.

<figure class="essay-figure"><img src="/images/articles/evals-are-the-new-prd-tally.webp" alt="Ink drawing of an empty doormat below a closed mail slot, with a hand tally counter reading 0216 in one corner." width="1536" height="1024" loading="lazy" decoding="async" /></figure>

Those are activity numbers.
The outcome is landing a role I want.
The system never put that question in front of me.
I didn't ask it often enough either.
Meanwhile the search drifted.
My LinkedIn profile went stale.
I reviewed every application before it went out.
But I let agents maintain the resume underneath them and stopped reading it closely.
Then an interviewer told me they had found an issue in it.
When I went back, some bullets described my work in ways I never would have.

The parts that worked were shaped like evals.
I checked the AI's match score against my own judgment and found it rated jobs 36.7 points higher than I did on average.
Six of the seven jobs it ever scored 100 were ones I later marked not applicable.
That comparison is why the score is calibrated now.
In one late-July week, 38 applications to the roles I was targeting produced a single screen, while five of the eight recruiters writing to me were hiring for mobile work.
Looking at what was actually answering changed where I searched.

A job search is bigger than its pipeline.
If I wrote its eval now, the cases would be the fundamentals.
Does everything with my name on it say what I would say?
Are the roles I chase the ones where I get conversations?
How much of my time goes to people rather than forms?
Am I improving on the interview questions that keep tripping me up?
Is the search still pointed at the work and the life I want?
Applications sent would barely figure in it.

Recruiter screens are in progress and there is no offer yet.
My system can tell me exactly how many applications went out.
The eval I should have written first would tell me whether I'm closer to the job.

## What an eval can't do

An eval only measures what someone thought to write down.
A set built to catch badly formatted output will say nothing about well-formatted output full of wrong facts.
Deciding which failures deserve a set is still the real product work.
The eval is where that judgment gets written down.
It keeps working after you have moved on to the next problem.
