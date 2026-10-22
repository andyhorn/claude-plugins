---
name: docket
description: Work through a list of decisions (review findings, open questions, lint results) with the user one item or one batch of related items at a time, carrying earlier rulings forward as precedent for later items. Use for /docket, for the handoff section of a triage report, or when the user wants to go through findings or open questions one by one.
---

# Docket

Work through a list of decisions with the user one item, one tightly-scoped group, or one batch of related items at a time. Never dump the whole list and never advance past an item without an answer.

Two mechanisms reduce round-trips, and they are different things:

- **Group** — near-duplicate items with an identical decision, collapsed into *one question*.
- **Batch** — several related items with *different* decisions, asked as up to 4 questions in a single AskUserQuestion call. The UI renders each question as a tab, so the user answers them back-to-back and submits once.

## Workflow

1. **Build the full list first.** Gather every item before presenting any of them — read the diff, run the linter, collect the findings, whatever surfaces the full set. Don't discover items mid-loop if the source lets you enumerate up front; a running total ("item 3 of 11") requires knowing 11 in advance. If a triage report exists in scope (`docs/code-review/<slug>/triage.md`), build the list from its `## Handoff` section instead of the raw review — settled verdicts are not items to decide. An explicit list passed by the caller (as an argument or handed over in chat) takes precedence over the triage report lookup.
2. **Track state.** Use TodoWrite with one entry per item (or per group), plus a running note of decisions made so far. This is what lets you detect cross-item dependencies in step 4 and produce the closing summary in step 8.
3. **Group only when both hold:** the items are near-duplicates (same root cause, same file pattern, same finding type) AND the fix/decision is identical across them. Present the group as one question, but list every instance it covers in the body so the user knows what they're deciding for. When in doubt, don't group — a false-group forces one answer onto items that deserved different ones; the fix is presenting one extra question, which is cheap.
4. **Before presenting an item, check whether an earlier decision already resolves it.** This is common, not an edge case — e.g. "reject all TODO-style comments" resolves every later comment-style finding. When it's fully resolved:
   - Say so explicitly ("per your answer on #2, this one follows the same fix") — don't ask again and don't silently skip. Update the todo for that item to reflect the resolution instead.
   When it's *partially* constrained (an earlier choice narrows the options but doesn't decide it), adjust the offered options to only the ones still consistent with the earlier choice, and say what was narrowed and why. A confirmed triage verdict is precedent too: never re-ask it, and cite its `T` id when a later item inherits the decision.
5. **Form batches.** After grouping, cluster the remaining items into batches of 2-4 that are related (same file, same module, same theme, same finding family) so the user stays in one mental context. A batch is valid only if **no question's options or relevance depend on another question's answer in the same batch** — answers arrive together, so you can't narrow later options by earlier ones (step 4 only works across batches). If item B depends on item A, put them in different batches, A first. Items that don't relate to anything else go alone as a single question. When in doubt, don't batch — a batch built on a hidden dependency forces answers made blind.
6. **Present one batch at a time using AskUserQuestion**, then stop and wait for the response before doing anything else — no queuing up the next batch, no proceeding on an assumed answer. One AskUserQuestion call per turn; put the whole batch in its `questions` array. For each question:
   - `header` (max 12 chars): the tab label — a short identifier for the item (e.g. `#3 auth.dart`), so the user can tell tabs apart at a glance.
   - The question text: file/location or clear identifier, plus a one- or two-sentence description — enough to decide without re-reading source, but not a full essay. Prefix with the running position ("Item 3 of 11") and, for a batch, mention the batch theme in the first question.
   - A small set of concrete, mutually exclusive options (2-4). Reuse the same option set across a group's or batch's members where it applies. AskUserQuestion always offers an implicit "Other" — don't add your own catch-all option for that.
7. **Apply the decisions before moving on.** Process each answer in the batch in order (edit the file, mark the todo resolved, note the choice against any items it constrains), then check whether any answer resolves or narrows items in later batches (step 4) before building the next batch. If an answer is "Other" with free text that changes the picture, re-plan the remaining batches rather than pushing on.
8. **Close with a summary**: every item, the decision made, and what (if anything) was applied as a result. If any item was resolved by inheritance from an earlier choice rather than asked directly, call that out in the summary too.

## Common mistakes

- Presenting the whole list as a single long message with all options inline — defeats the wait-for-response contract; the user can't course-correct later items based on how earlier ones went.
- Putting more than 4 questions in a batch or a whole docket in one call — AskUserQuestion allows 1-4 questions; split larger sets into successive batches.
- Batching items where one answer would change another's options — those belong in separate, ordered batches.
- Confusing grouping with batching: a group is one question covering identical decisions; a batch is several questions covering different decisions.
- Grouping by superficial similarity (same file, same error code) when the actual fix differs per instance — ask individually instead.
- Missing a cross-item dependency and asking a question whose answer was already implied, forcing the user to repeat themselves.
- Applying a decision's downstream effects silently without telling the user which later items it resolved — they lose track of why something didn't come up.
- Issuing multiple AskUserQuestion calls in one turn "to save round-trips" — breaks the wait-for-response contract. Use one call with several questions (a batch) instead.
