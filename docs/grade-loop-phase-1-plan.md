# Grade-Loop Phase 1 Plan: Stop the Infinite Loop

This is the first of three planned PRs to make the `rigor:grade-loop` reviewer converge once real risk is gone, instead of cycling into pedantry.

## Goal

Keep the adversarial reviewer, but add guardrails so that:

- the pass threshold is achievable,
- only the highest-impact issues block a pass,
- progress itself becomes a stop condition,
- the reviewer remembers what it already checked,
- the user can break a bad loop.

## Scope

Phase 1 covers the quick calibration and process-structure changes that can land without rewriting the rubric.

| Option | Change |
|--------|--------|
| 1. Lower the pass threshold | Default stop condition changes from `>= 90` to `>= 85`. |
| 2. Cap MUST-FIX items | Reviewer emits at most 3 highest-impact deductions as `MUST-FIX`; the rest go in `ADVISORY`. |
| 3. Add a severity filter | Every deduction is tagged `[BLOCKING]` or `[ADVISORY]`; only `[BLOCKING]` can block a pass. |
| 4. Recognize progress | Stop early if the score rose, no `[BLOCKING]` items remain, and the rest are `ADVISORY` or `UNCONFIRMED`. |
| 5. Preserve reviewer continuity | Packet includes prior deductions/changes so the reviewer focuses on new work, not a fresh fishing expedition. |
| 10. Add an escalation rule | The main agent can ask the user whether a `MUST-FIX` is worth more rework. |
| 11. Track a review journal | Maintain a cross-round journal of fixed/pending/dismissed deductions; reviewer cannot re-introduce fixed items. |

## Files to change

- `plugins/rigor/skills/grade-loop/SKILL.md`
- `plugins/rigor/agents/work-reviewer.md`
- `test/rigor/grade-loop.test.mjs` (new)

## Proposed acceptance criteria

1. `work-reviewer` output includes `[BLOCKING]` / `[ADVISORY]` severity tags.
2. `MUST-FIX` contains no more than 3 items.
3. The grade-loop stops when:
   - score >= 85 **and** no `[BLOCKING]` items remain, **or**
   - score improved over the prior round, no `[BLOCKING]` items remain, and only `[ADVISORY]`/`UNCONFIRMED` items are left.
4. The review journal is honored: a previously fixed item cannot be re-reported as a new deduction.
5. All existing tests continue to pass.

## Later phases

- **Phase 2:** Rubric redesign (acceptance-criteria gating, correctness vs. polish, calibration examples).
- **Phase 3:** User strictness setting (`lenient` / `balanced` / `adversarial`).
