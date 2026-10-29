---
name: grade-loop
description: >
  Use before declaring any deliverable done (a file you wrote or changed, a written
  plan, or a document). Dispatches the rigor:work-reviewer agent to run an
  acceptance gate first: every explicit requirement must be MET, every author claim
  must be VERIFIED, there must be no REFUTED claims, and there must be no
  [BLOCKING] deductions. If the gate passes, the reviewer scores correctness out
  of 75 and polish out of 25 for a combined 0-100 total. Rework every
  [BLOCKING] MUST-FIX item, and repeat until the acceptance gate passes, the
  total meets the mode's pass threshold with no [BLOCKING] deductions remaining,
  until a progress stop condition is met, or until the round cap is reached.
  Not for chat replies, routine commands, or one-line lookups.
---

# Grade Loop

A deliverable is not done until `rigor:work-reviewer` reports an **acceptance gate PASS**, a total score at or above the mode's pass threshold, no [BLOCKING] deductions remaining, and an empty MUST-FIX list. You never grade your own work, and you never argue a score down without new primary-source evidence.

## When it applies

The "Grade deliverables" rule in `rules.md` defines what counts as a deliverable and which edits are trivial. Chat replies, routine commands and one-line lookups are never deliverables.

## Procedure

1. Make the deliverable durable first: write the file or make the change. The reviewer reads the real artifact, not your description of it.
2. Build the review packet. Create a file in a scratchpad directory (use `/tmp` only if there is none, but prefer a project scratchpad). The packet must include all of the following, so large diffs and logs stay out of the dispatch prompt:
   - The original task text, quoted from the user.
   - The strictness mode: `strictness:<lenient|balanced|adversarial>`. Read `plugins/rigor/rules.md` for the current thresholds and caps. If the user did not specify a mode, use `balanced`. Once chosen for this deliverable, do not change the mode between rounds.
   - The exact file paths of the deliverable.
   - An **acceptance checklist**: the explicit requirements you derived from the task, as a numbered list. Be specific; the reviewer will mark each one MET, PARTIAL, or NOT MET.
   - Your claims, as a numbered list. Include every statement of the form "this works", "this passes", or "this is current".
   - For code or config, the verify output: run the project's verify command first, either yourself or through a test-runner agent if you have one, and paste the exact command, its exit status, and its full unedited output. The reviewer cannot run commands. Run it again after every rework, before the next dispatch.
   - The required severity tags: every deduction in the reviewer's output must be tagged [BLOCKING] or [ADVISORY]. You do not add them; you verify that the reviewer does.
   - For a deliverable inside a git repo, the git state: run `git status --short --untracked-files=all` yourself and paste the output unedited. `git diff` omits untracked files, so the status output must list each one by file path. For uncommitted work, also paste `git diff HEAD --stat` and `git diff HEAD`. For committed work, name the base branch and paste `git log <base>..HEAD --oneline`, `git diff <base>...HEAD --stat` and `git diff <base>...HEAD`. Use both sets when some work is committed and some is not.
   - Never include prior scores or the round number. They anchor the reviewer. Score each round blind.
   - From round 2 on, add a **Prior must-fix items** list: the earlier [BLOCKING] MUST-FIX items, worded as the reviewer wrote them. The reviewer checks each one and reports it apart from the score. The score covers the whole deliverable, not only that list.
   - From round 2 on, add a **Review journal** section: copy the current contents of the review journal file. If there is no journal file yet, start one. The reviewer uses it to avoid re-reporting items that have already been fixed or dismissed.
3. Dispatch the `rigor:work-reviewer` agent with the path to the packet file. Tell it which worktree it is in: the main worktree, a shared worktree, or its own isolated worktree. Use a fresh dispatch each round. Do not reuse context.
4. Read the result. Read the pass threshold and MUST-FIX cap for the chosen mode from `plugins/rigor/rules.md`.
   - **Pass:** acceptance gate **PASS**, total score at or above the mode's pass threshold, no [BLOCKING] deductions remain, and the MUST-FIX list is empty: stop. Report the correctness, polish, total, and the CHECKED list to the user.
   - **Progress stop:** the score rose since the previous round, no [BLOCKING] deductions remain, and only [ADVISORY] or `UNCONFIRMED` items are left: stop. Report the score, the remaining advisory items, and the improvement to the user. UNCONFIRMED items should still go back to the user as open questions.
   - **Rework:** acceptance gate **FAIL**, total score below the mode's pass threshold, any [BLOCKING] item remains, or MUST-FIX is non-empty: rework every [BLOCKING] MUST-FIX item. Do not skip one because you disagree. If you think an item is wrong, check it against a primary source and say so in the next packet.
5. After every rework, repeat from step 2: re-run the verify command and rebuild the packet with the new acceptance checklist, the new verify output, the new git state, the prior must-fix items, and the updated review journal.
6. Cap: use the mode's MUST-FIX cap from `plugins/rigor/rules.md`. If the final round does not meet a stop condition in step 4, stop. Show the user the score, the open [BLOCKING] and [ADVISORY] deductions, and what you tried. Do not start another round without the user's go-ahead.

## Review journal

Maintain the journal in a file named `review-journal.md` in your scratchpad directory. If you are grading multiple deliverables in the same scratchpad, name it `review-journal-<deliverable>.md`. Update it after each reviewer round, before the next dispatch. Use this format:

```markdown
# Review journal: <deliverable>

## Round <n> - Score: <score>

| Deduction | Severity | Status | Change made |
|---|---|---|---|
| <original deduction wording> | [BLOCKING] / [ADVISORY] | fixed / pending / dismissed | <description of the change, or why it was dismissed> |
```

Rules for the journal:

- `fixed`: the change addressed the deduction. A fixed deduction must not be reported again in later rounds unless it clearly regressed.
- `pending`: the deduction is still present or the change was incomplete. A pending deduction may be reported again.
- `dismissed`: the user explicitly accepted the risk. Record the user's reason. A dismissed deduction must not be re-introduced by the reviewer.

When you add a new round, copy the previous round's pending items forward and update their status based on the latest review. This continuity keeps the reviewer focused on what changed instead of starting over each round.

## User escalation

If a [BLOCKING] MUST-FIX item would require large rework, is low-impact, or conflicts with the user's explicit instructions, you may ask the user whether to dismiss that item and proceed. If they agree, record it in the review journal as `dismissed` with the user's reason, and continue without fixing it. Do not hide the item; it stays visible in the journal.

## Report to the user

State the round count, each round's score (correctness, polish, total, acceptance gate), and what changed between rounds. Quote the reviewer's score line exactly. Do not paraphrase a score upward. List any [BLOCKING] or [ADVISORY] items that are still open when you stop.

## Rules

- A claim that the reviewer marks UNCONFIRMED goes to the user as unconfirmed, or you verify it.
- Do not ask the reviewer for a "quick" or "lenient" pass.
- The reviewer is read-only and cannot run commands. You make all fixes and you run all checks.
- A fixed or dismissed deduction from the review journal must not be re-reported by the reviewer in a later round unless it regressed.
- MUST-FIX never contains more than the mode's [MUST-FIX] cap from `plugins/rigor/rules.md`; anything else is advisory.
- The acceptance checklist is required in the packet from round 1 onward.
- The strictness mode and pass threshold/cap are read from `plugins/rigor/rules.md`; do not assume the old defaults of 85 and 3.
