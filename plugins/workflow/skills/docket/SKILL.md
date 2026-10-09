---
name: docket
description: Work through a list of decisions (review findings, open questions, lint results) with the user one item at a time, carrying earlier rulings forward as precedent for later items. Use for /docket, or when the user wants to go through findings or open questions one by one.
---

# Docket

Work through a list of decisions with the user one item (or one tightly-scoped group) at a time. Never dump the whole list and never advance past an item without an answer.

## Workflow

1. **Build the full list first.** Gather every item before presenting any of them — read the diff, run the linter, collect the findings, whatever surfaces the full set. Don't discover items mid-loop if the source lets you enumerate up front; a running total ("item 3 of 11") requires knowing 11 in advance.
2. **Track state.** Use TodoWrite with one entry per item (or per group), plus a running note of decisions made so far. This is what lets you detect cross-item dependencies in step 4 and produce the closing summary in step 6.
3. **Group only when both hold:** the items are near-duplicates (same root cause, same file pattern, same finding type) AND the fix/decision is identical across them. Present the group as one question, but list every instance it covers in the body so the user knows what they're deciding for. When in doubt, don't group — a false-group forces one answer onto items that deserved different ones; the fix is presenting one extra question, which is cheap.
4. **Before presenting an item, check whether an earlier decision already resolves it.** This is common, not an edge case — e.g. "reject all TODO-style comments" resolves every later comment-style finding. When it's fully resolved:
   - Say so explicitly ("per your answer on #2, this one follows the same fix") — don't ask again and don't silently skip. Update the todo for that item to reflect the resolution instead.
   When it's *partially* constrained (an earlier choice narrows the options but doesn't decide it), adjust the offered options to only the ones still consistent with the earlier choice, and say what was narrowed and why.
5. **Present one item (or group) at a time using AskUserQuestion**, then stop and wait for the response before doing anything else — no queuing up the next item's question, no proceeding on an assumed answer. Each presentation needs:
   - The item: file/location or clear identifier.
   - A one- or two-sentence description of the issue or decision — enough to decide without re-reading source, but not a full essay.
   - A small set of concrete, mutually exclusive options (2-4). Reuse the same option set across a group's members where it applies. AskUserQuestion always offers an implicit "Other" — don't add your own catch-all option for that.
6. **Apply the decision before moving on** (edit the file, mark the todo resolved, note the choice against any items it constrains), then proceed to the next item.
7. **Close with a summary**: every item, the decision made, and what (if anything) was applied as a result. If any item was resolved by inheritance from an earlier choice rather than asked directly, call that out in the summary too.

## Common mistakes

- Presenting the whole list as a single long message with all options inline — defeats the one-at-a-time contract; the user can't course-correct item 2 based on how item 1 went.
- Grouping by superficial similarity (same file, same error code) when the actual fix differs per instance — ask individually instead.
- Missing a cross-item dependency and asking a question whose answer was already implied, forcing the user to repeat themselves.
- Applying a decision's downstream effects silently without telling the user which later items it resolved — they lose track of why something didn't come up.
- Batching multiple AskUserQuestion calls in one turn "to save round-trips" — breaks the wait-for-response contract.
