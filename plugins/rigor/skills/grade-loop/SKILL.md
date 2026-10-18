---
name: grade-loop
description: Use before declaring any deliverable done (a file you wrote or changed, a written plan, or a document). Dispatches the rigor:work-reviewer agent to score the work 0-100, reworks every deduction, and repeats until the score is 90 or more or the round cap is reached. Not for chat replies, routine commands, or one-line lookups.
---

# Grade Loop

A deliverable is not done until `rigor:work-reviewer` scores it 90 or more with an empty MUST-FIX list. You never grade your own work, and you never argue a score down without new primary-source evidence.

## When it applies

The "Grade deliverables" rule in `rules.md` defines what counts as a deliverable and which edits are trivial. Chat replies, routine commands and one-line lookups are never deliverables.

## Procedure

1. Make the deliverable durable first: write the file or make the change. The reviewer reads the real artifact, not your description of it.
2. Build the review packet as a file in your scratchpad directory (use `/tmp` only if there is none). Put the full text of every item below in that file, so large diffs and logs stay out of the dispatch prompt:
   - The original task text, quoted from the user.
   - The exact file paths.
   - Your claims, as a numbered list. Include every statement of the form "this works", "this passes", or "this is current".
   - For code or config, the verify output: run the project's verify command first, either yourself or through a test-runner agent if you have one, and paste the exact command, its exit status, and its full unedited output. The reviewer cannot run commands. Run it again after every rework, before the next dispatch.
   - For a deliverable inside a git repo, the git state: run `git status --short --untracked-files=all` yourself and paste the output unedited. `git diff` omits untracked files, so the status output must list each one by file path. For uncommitted work, also paste `git diff HEAD --stat` and `git diff HEAD`. For committed work, name the base branch and paste `git log <base>..HEAD --oneline`, `git diff <base>...HEAD --stat` and `git diff <base>...HEAD`. Use both sets when some work is committed and some is not.
   - Never include prior scores or the round number. They anchor the reviewer. Score each round blind.
   - From round 2 on, add a separate "Prior must-fix items" list: the earlier MUST-FIX items, worded as the reviewer wrote them. The reviewer checks each one and reports it apart from the score. The score covers the whole deliverable, not only that list.
3. Dispatch the `rigor:work-reviewer` agent with the path to the packet file. Tell it which worktree it is in: the main worktree, a shared worktree, or its own isolated worktree. Use a fresh dispatch each round. Do not reuse context.
4. Read the result.
   - Score 90 or more with an empty MUST-FIX list: stop. Report the score and the CHECKED list to the user.
   - Score under 90, or any MUST-FIX item at any score: rework every MUST-FIX item. Do not skip one because you disagree. If you think an item is wrong, check it against a primary source and say so in the next packet.
5. After every rework, repeat from step 2: re-run the verify command and rebuild the packet with the new verify output, the new git state, and the prior must-fix items.
6. Cap: 3 rounds. If round 3 does not meet the stop condition in step 4 (a score under 90, or any open MUST-FIX item), stop. Show the user the score, the open deductions, and what you tried. Do not start a fourth round without the user's go-ahead.

## Report to the user

State the round count, each round's score, and what changed between rounds. Quote the reviewer's score line exactly. Do not paraphrase a score upward.

## Rules

- A claim that the reviewer marks UNCONFIRMED goes to the user as unconfirmed, or you verify it.
- Do not ask the reviewer for a "quick" or "lenient" pass.
- The reviewer is read-only and cannot run commands. You make all fixes and you run all checks.
