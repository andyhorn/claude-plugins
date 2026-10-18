---
name: plan-stress-test
description: Use when planning a task of three or more steps, a plan that spends the user's money or hours, or a plan that changes shared or hard-to-reverse state, or immediately after such a plan is written. Runs two read-only persona agents in parallel, rigor:operator (the user's finite time, energy, interest, money) and rigor:adversary (tries to make the plan fail), then merges both into the plan. Not for one- or two-step tasks that spend nothing, change no shared state, and are easy to undo.
---

# Plan Stress Test

Every non-trivial plan gets two critics before the user sees it as final. You merge their output. You do not paste it through.

## When it applies

The "Stress-test plans" rule in `rules.md` defines which plans need a stress test. Routine commands never do.

## Procedure

1. Write the plan down. Use a file for a plan over about 15 lines.
2. Collect the constraints you know: time, energy, interest, money. Take them from the user's words and from memory files you have verified. Mark everything else UNKNOWN. Do not invent them.
3. Dispatch `rigor:operator` and `rigor:adversary` in the same turn, so they run in parallel. Give each agent the plan, the constraints, and the facts the plan relies on. Tell each which worktree it is in. Both agents are read-only.
4. Synthesize:
   - Take the Adversary's show-stoppers and ranked failure modes. Change the plan to remove each one, or state that you accept the risk and why.
   - Take the Operator's likely-to-fail steps and smallest viable plan. Cut or shrink steps that the user's resources cannot support.
   - Where the two conflict (the safe step costs too much), say so and give a recommendation, not a list of options.
   - Any assumption the Adversary marked REFUTED: change the plan so it stops relying on that assumption, or drop the step that depends on it.
   - Anything either agent marked UNCONFIRMED, UNKNOWN, or GUESS goes to the user as an open question.
5. Present the revised plan. Show a short "what the stress test changed" section: what you cut, what you added, and what you accepted. Do not present the raw agent reports unless the user asks.
6. If the plan then becomes a written deliverable, run `rigor:grade-loop` on it.

## Rules

- Do not skip the adversary because the plan "looks fine".
- Do not average the two views. Decide, and give the reason.
- Facts that can go stale must come back CONFIRMED by a fresh check, or they stay open questions.
