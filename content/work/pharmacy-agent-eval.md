---
title: "Evaluating a multi-turn agent for a national pharmacy chain"
sector: "U.S. national pharmacy chain"
role: "Principal Experience Architect"
duration: "~ 4 months, 2025–2026"
pillar: "Evaluation as a design discipline"
sub: "An eval-harness build for a refill, transfer, and adherence agent — where \"good\" was harder to define than \"working.\""
draft: true
---

## § 01 — context

### The work

A national U.S. pharmacy retailer was piloting a multi-turn voice and text agent for three intertwined tasks — refill requests, transfer initiation, and adherence check-ins. The model was already chosen; the integration with the patient-record system was already half-built. What was missing was a way to tell whether the thing was actually *good enough to ship to a regulated audience*.

I came in to design the evaluation harness — not as a test suite, but as **the team's evolving definition of what good behavior meant**. The brief was nominally engineering; the real work was design.

---

## § 02 — the constraint that mattered

### "Working" and "good" were not the same thing

The team had been measuring task completion. Did the refill go through? Did the transfer succeed? Did the patient confirm? Those numbers were already at 92%. The pilot was, by that measure, working.

But when I sat with the recordings, the failure modes I cared about lived *inside* the 92%. The agent had completed the refill — and along the way, mis-pronounced the patient's name, missed a cue that the patient was confused, and offered a generic adherence reminder that contradicted what the doctor had told them last week. Task completion was a true statement and a useless one.

<div class="diagram">
  <svg viewBox="0 0 720 280" xmlns="http://www.w3.org/2000/svg" aria-label="Two evaluation surfaces — task completion vs experiential quality">
    <text x="20" y="30" style="font-weight:600">How the team was measuring it</text>
    <rect x="20" y="50" width="320" height="180" class="stroke" rx="3"/>
    <rect x="40" y="190" width="280" height="22" class="fill-soft" rx="2"/>
    <rect x="40" y="190" width="258" height="22" style="fill:var(--accent)" rx="2"/>
    <text x="50" y="206" style="fill:var(--paper);font-weight:600">Task completion · 92%</text>
    <text x="40" y="80" class="dim">✓ refill</text>
    <text x="40" y="100" class="dim">✓ transfer</text>
    <text x="40" y="120" class="dim">✓ confirm</text>
    <text x="40" y="140" class="dim">✓ log</text>
    <text x="40" y="160" class="dim">✓ close</text>
    <text x="380" y="30" style="font-weight:600">What was happening inside the 92%</text>
    <rect x="380" y="50" width="320" height="180" class="stroke" rx="3"/>
    <circle cx="430" cy="100" r="6" class="accent"/>
    <text x="446" y="105" class="dim">name mispronunciation</text>
    <circle cx="430" cy="130" r="6" class="accent"/>
    <text x="446" y="135" class="dim">missed confusion cue</text>
    <circle cx="430" cy="160" r="6" class="accent"/>
    <text x="446" y="165" class="dim">contradicted clinician advice</text>
    <circle cx="430" cy="190" r="6" class="accent"/>
    <text x="446" y="195" class="dim">tone slip on sensitive topic</text>
    <text x="390" y="80" class="label-italic">the things task-completion didn't see</text>
  </svg>
  <p class="caption"><svg class="icon sm"><use href="#i-bar"/></svg> <em>Figure 1</em> — Two views of the same conversation.</p>
</div>

## § 03 — approach

### An eval rubric, designed before it was instrumented

I treated the eval rubric as a design artifact and ran it through three loops:

**Loop one** was language. We spent two weeks *writing* what good looked like in plain English with three pharmacists, two patient-advocacy reps, and a compliance lead. No code. No metrics. Just sentences describing what an empathetic, accurate, safe agent would say and not say. Forty-eight rules.

**Loop two** was classification. We hand-labeled ~600 real conversations against the forty-eight rules, then collapsed redundant ones, then split overloaded ones. We ended at twenty-two rules in four categories: *safety, accuracy, comprehension, dignity*.

**Loop three** was the harness. *Then*, and only then, the engineering team built the eval harness — half LLM-as-judge, half deterministic checks, with a quarterly human re-grading sample to catch model drift.

<div class="metric-row">
  <div class="metric">
    <p class="n">~ 40%</p>
    <p class="l"><svg class="icon sm"><use href="#i-trend-down"/></svg> Reduction in escalations</p>
    <p class="c">after the dignity rule set was deployed</p>
  </div>
  <div class="metric">
    <p class="n">22</p>
    <p class="l"><svg class="icon sm"><use href="#i-layers"/></svg> Rules in the eval rubric</p>
    <p class="c">collapsed from an initial 48</p>
  </div>
  <div class="metric">
    <p class="n">3 ×</p>
    <p class="l"><svg class="icon sm"><use href="#i-zap"/></svg> Faster regression catches</p>
    <p class="c">on prompt and model updates</p>
  </div>
</div>

## § 04 — reflection

### What I'd do differently

The two-week language loop felt expensive at the time and was the highest-leverage two weeks of the engagement. If I were starting again I would push for three. I would also start the human re-grading sample *before* the harness was live, not after. By the time we realized the LLM-judge was drifting on the dignity category, we had been shipping against a stale standard for almost a month.

The transferable claim, which I've since put in writing more directly: *evals are about deciding what good looks like, and that's a design problem.* If the design hasn't happened, the harness is measuring the wrong thing — confidently.
