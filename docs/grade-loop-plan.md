<!-- markdownlint-disable MD029 MD032 -->

PR 1: Stop the infinite loop (options 1‑5, 10, 11)
Goal: keep the adversarial reviewer, but make the loop converge once real risk is gone.
Files:
- plugins/rigor/skills/grade-loop/SKILL.md
- plugins/rigor/agents/work-reviewer.md
- test/rigor/grade-loop.test.mjs (new, structure tests)
Changes:
1. Lower the pass threshold (option 1)
- Change the stop condition from ≥ 90 to ≥ 85.
- Update the skill’s “stop condition” and the agent’s “Do not give 90 or more” text.
2. Cap MUST‑FIX items per round (option 2)
- Instruct the reviewer to emit at most 3 highest‑impact deductions in MUST-FIX.
- The rest go in a new ADVISORY section.
3. Add a severity filter (option 3)
- Every deduction line starts with [BLOCKING] or [ADVISORY].
- MUST‑FIX may only contain [BLOCKING] items.
- Pass requires no open [BLOCKING] items and score ≥ threshold.
4. Recognize progress as a stop condition (option 4)
- Stop early when:
- score went up from the prior round,
- all remaining deductions are [ADVISORY] or UNCONFIRMED,
- no [BLOCKING] must‑fix remains.
- Record each round’s score in the review journal to detect progress.
5. Preserve reviewer continuity (option 5)
- The packet now includes a “Prior context” section: previous MUST‑FIX, ADVISORY, and what changed.
- The reviewer is told to focus on those and on new changes, not to rediscover the file from scratch.
- The packet still omits the prior numeric score.
6. Escalation rule (option 10)
- Add a step: if the main agent thinks a [BLOCKING] item is pedantic or already fixed, it can quote the deduction to the user and ask whether to keep reworking.
- This becomes the only way to skip a MUST‑FIX.
7. Review journal (option 11)
- Maintain a scratchpad journal across rounds:
- deduction, status (fixed / pending / dismissed), round.
- The reviewer must verify fixed items and cannot re‑introduce a previously fixed item as a new deduction.
- Add a REGRESSIONS section in the output.
PR 2: Redesign the rubric (options 6‑9)
Goal: move from “adversarial 0‑100 fishing” to “acceptance gate + polish score.”
Files:
- plugins/rigor/agents/work-reviewer.md
- plugins/rigor/agents/work-reviewer/examples.md (new)
- plugins/rigor/skills/grade-loop/SKILL.md
- plugins/rigor/README.md
Changes:
 8. Explicit claim checking before scoring (option 6)
- The reviewer must first list every author claim and mark it VERIFIED / REFUTED / UNCONFIRMED.
- If there are no REFUTED claims and no missing explicit requirements, the reviewer may not invent open‑ended deductions; deductions must map to the rubric criteria.
 9. Switch to acceptance‑criteria gating (option 7)
- Derive a checklist from the original task text: each explicit requirement gets MET / PARTIAL / NOT MET.
- Pass requires every explicit requirement MET, every claim VERIFIED, and no REFUTED claims.
10. Separate correctness from polish (option 9)
- Keep a 0‑100 score, but split it visibly:
- Correctness gate (0‑75 points): Claims + Requirements + Correctness/edge cases.
- Polish score (0‑25 points): Scope/simplicity + clarity/maintainability.
- Passing the loop requires the correctness gate to be satisfied; polish deductions can lower the total but cannot block a pass by themselves.
11. Anchor scoring with examples (option 8)
- Add examples.md with 2‑3 calibration cases:
- e.g. “This plan scores 88 because all claims are verified, all requirements are met, and the only remaining issue is a wording nit…”
- Reference the examples in the agent prompt so the reviewer uses them as guardrails.
12. Update the packet format
- The packet now asks for the acceptance checklist, severity tags, and review journal; update the skill accordingly.
PR 3: User strictness setting (option 12)
Goal: let the user choose how adversarial the reviewer should be.
Files:
- plugins/rigor/rules.md
- plugins/rigor/skills/grade-loop/SKILL.md
- plugins/rigor/agents/work-reviewer.md
- plugins/rigor/README.md
- plugins/rigor/.claude-plugin/plugin.json
Changes:
13. Add strictness setting
- Three modes: lenient, balanced (default), adversarial.
- Effects:
- lenient: pass threshold 80, MUST‑FIX cap 2, more edge cases treated as ADVISORY.
- balanced: pass threshold 85, MUST‑FIX cap 3.
- adversarial: pass threshold 90, MUST‑FIX cap 5, stricter edge‑case scrutiny.
14. Plumb the setting through the loop
- The skill reads the setting from user config / env / a simple rule and injects it into the packet.
- The agent prompt tailors its tone and thresholds based on the setting.
15. Document and version
- Update README.md with the new strictness setting.
- Bump plugin version to 0.3.0.
Suggested acceptance criteria
- All existing tests still pass (npm test or equivalent).
- New tests verify:
- reviewer output contains severity tags,
- review journal is honored,
- pass threshold is 85 by default,
- strictness modes adjust thresholds.
- README.md and rules.md accurately describe the new behavior.
Risks / open questions
- Threshold choice: 85 is a starting guess; you may want to tune it after a week of usage.
- Reviewer continuity: including too much prior context can anchor the reviewer in the wrong way. We should include only the prior deductions and the diff of changes.
- Acceptance gating: requires the original task to have clear requirements. If the task is vague, the reviewer may still drift.
Let me know if you want me to write this plan to /Users/andrew/.opencode/plan, or if you want to adjust the PR split first.
