---
name: triage
description: Sort code review findings into necessary, beneficial, defer, and discard verdicts, with a citation or flag for each, and hand only the open decisions to docket. Use after /code-review, /review, or any pasted list of findings, or when the user wants a review triaged instead of walked through item by item. Read-only unless the user asks to apply fixes.
argument-hint: "[FINDING ids | path to review.md | pasted findings]"
---

# Triage

Turn a list of review findings into four verdicts: **Necessary**, **Beneficial**, **Defer**, **Discard**. Every verdict carries a rule id, a citation, and a confidence. Triage is read-only: it reports and asks, and edits code only after an explicit choice to apply.

The whole point is to answer "what must I do before this change is done, what would I like to do, and what should I ignore?" — without asking the user about every finding. If you find yourself presenting findings as individual questions, you are running `docket`, not triage.

## When to use

- After `/code-review`, `/vgv-wingspan:review`, `/review`, or a lint run.
- When findings are pasted into the conversation.
- When the user says a review is overwhelming, asks what actually matters, or asks what can be ignored.

Do not use it to re-review code, to fix findings without being asked, or to walk through decisions interactively. That last one is `docket`; triage hands off to it.

## Inputs

Resolve the source in this order and stop at the first that yields findings. Say which one you used.

1. **Explicit argument** — finding ids (`FINDING-01 FINDING-04`), a rule id, or a path to a review report.
2. **The review report** — `docs/code-review/<slug>/review.md`, preferring the slug for the current branch, otherwise the most recently modified. Read `raw/` reports only when a finding's `why` or `fix` is too thin to restate as a claim.
3. **Pasted findings** — the list in the conversation.
4. **Nothing found** — ask one question about the source. Never invent findings.

Preserve `FINDING-NN`, the reviewer's rule id (`vgv/force-unwrap`), and the verdict rule id (`N1`) as separate fields; they are how the user refers to findings later. If a line number is stale, relocate the code by content and note the new location. If a finding is already resolved on this branch, keep it in the report as a `D2 Redundant` entry so the user can see it was considered.

A report that exists only in git history is not a source. Read the working tree; if the report was deleted and you need it, ask. When the findings are pasted or come from an argument rather than a report, use the branch slug for the file path — do not infer a slug from an unrelated path that happens to contain a report.

## Procedure

1. **Collect and normalize.** Build the complete list before judging any of it. Restate each finding as one falsifiable claim. Merge exact duplicates and keep every source id and the reporting agent. Group before you rule: one entry per root cause, listing every instance it covers.
2. **Verify.** Read the code for every claim and record `confirmed`, `refuted`, or `can't tell`, with a citation. Determine scope from the diff. Do not inherit the reviewer's severity or `why`; recompute the consequence. `can't tell` goes to Needs your call and gets no verdict.
3. **Group causes.** Bucket causes, not instances. Split a cluster when instances have different consequences (one crashes, the rest are cosmetic). Merge opposing findings ("extract this" vs. "inline this") into one entry with one decision — never two verdicts that cancel out.
4. **Apply the ladder.** Read [the verdict rules](references/verdict-rules.md) and apply them in order; the first match wins. Record the verdict rule id and confidence for every entry, keeping the reviewer's rule id alongside it. Discard requires high confidence and a citation. Necessary may stand on medium confidence but gets a verify flag.
5. **Render.** Produce the chat report and write the triage file. Both come from the same ordered list so they cannot drift.
6. **Confirm.** One `AskUserQuestion` call, at most four questions. Low-confidence and unverifiable items are asked here, never binned.
7. **Act or hand off.** Do nothing to the code until the user chooses. Then apply, hand off to docket, or stop.

For lists above roughly 25 findings, cluster by source rule first, verify every Necessary candidate individually, and sample discards while still citing each one. Verification is the expensive step; spend it where being wrong is costly, but never skip the citation for a discard.

## Chat report

The chat is the primary artifact. Lead with the file path and the counts, then show only what the user needs to act on.

````markdown
Triage of 11 findings, 10 entries (from docs/code-review/auth/review.md) — 2 necessary · 1 beneficial · 1 defer · 5 discard · 1 needs your call.
Full report: docs/code-review/auth/triage.md

## Needs your call

- **T1 · FINDING-04 · `vgv/swallowed-error` · cannot verify** — `retry()` may swallow a timeout. The timeout path is behind an injected clock I could not resolve. Confirm whether timeouts reach this catch block.

## Necessary

| # | Finding | Verdict rule | Conf | Scope | Why |
|---|---------|--------------|------|-------|-----|
| T2 | FINDING-01 · `tests/missing-test-file` · AuthCubit has no test file | `N3 Fails the gate` | High | introduced | The project gate requires a test file per cubit |
| T3 | FINDING-03 · `vgv/force-unwrap` · force-unwrap on token | `N1 Breaks behavior` | High | introduced | Crashes when the token is null |

## Beneficial

| # | Finding | Verdict rule | Conf | Scope | Why |
|---|---------|--------------|------|-------|-----|
| T4 | FINDING-05, -08 · `vgv/unit-suffix` · `parse()` drops the unit suffix | `B1 Cheap and material` | High | introduced | Callers format the wrong unit |

## Defer

- **T5 · FINDING-09 · F1 Pre-existing · latent: critical** — pre-existing null deref in `parseConfig` (lib/config.dart:88); untouched by this change.

## Discard

- **`D1 Refuted` ×2** — FINDING-06, -11: the null check is on the next line.
- **`D5 Preference` ×2** — FINDING-07, -12: no caller can hit the concerned path.
- **`D4 Mechanical` ×1** — FINDING-14: run `dart format`; do not hand-edit.

**Signal:** 2 of 5 discards are `simplicity/*`. That rule is noisy in this codebase; consider suppressing it.
````

Rules for the chat:

- **Needs your call** comes first when it exists, because it blocks a complete verdict. Number entries in render order: Needs your call, Necessary, Beneficial, Defer, Discard.
- Each finding cell keeps the source id and the reviewer's rule id (`FINDING-03 · vgv/force-unwrap`). The table's **Verdict rule** column is the `D1`/`N3` id that justifies the verdict — never the reviewer's rule.
- Defer is one line per entry, severe latent items first.
- Discard is collapsed into a histogram by **verdict rule** with one reason per rule, not one line per finding. Discards keep their `T` ids in the file; the chat groups them.
- **Counts are entries, not raw findings.** When grouping changes the number, say it once (`11 findings, 10 entries`). Show every verdict, including zeros, so the distribution is visible. A group's members are not separate entries.
- **Verdict rule ids always carry their name in backticks in chat** (`D1 Refuted`), never bare, so a verdict rule cannot be mistaken for an entry id. Entries are always `T#`.
- For `D4`, the line names the tool to run. Mechanical discards never enter the Handoff.
- **Signal** is optional and groups by the reviewer's rule id (`simplicity/*`), not by verdict rule. Add it only when one source rule dominates a verdict, and keep it to one sentence.
- Material problems you hit while verifying but that are not in the findings go in a short `## Aside`: one line each, no verdict, no `T` id, not counted. Never invent findings; this is only for something you actually encountered, such as a pre-existing compile error.
- Never print the full evidence blocks in chat; they live in the file.

## Triage file

Write `docs/code-review/<slug>/triage.md` without asking and mention the path once. Use the review's slug when there is one; otherwise use the current branch with `/` replaced by `-`; otherwise `working-tree`. Overwrite the same slug on a rerun, exactly like the review report.

The file uses the same order as the chat and adds evidence blocks:

````markdown
# Triage — <review scope>

Source: docs/code-review/<slug>/review.md (11 findings, 10 entries)
Verdicts: 2 necessary · 1 beneficial · 1 defer · 5 discard · 1 needs your call
Rule set: workflow:triage · 2026-10-20

## Needs your call

### T1 · FINDING-04 · `vgv/swallowed-error` · cannot verify · low
- **Claim:** `retry()` may swallow a timeout.
- **Truth:** can't tell — the timeout path runs through an injected clock that is not vendored in this repository.
- **Question:** Does a timeout reach this catch block?

## Necessary

### T2 · FINDING-01 · `tests/missing-test-file` · N3 Fails the gate · high
- **Claim:** AuthCubit has no test file.
- **Truth:** confirmed — no `auth_cubit_test.dart`; the gate requires one per cubit.
- **Consequence:** the project's test gate fails; state changes ship untested.
- **Scope:** introduced. **Cost:** moderate.
- **Source:** reviewer Critical; triage agrees.

## Beneficial

## Defer

## Discard

### T9 · FINDING-07 · `simplicity/inline-single-use` · D5 Preference · high
- **Claim:** the wrapper adds a hop.
- **Truth:** confirmed, but no caller can misuse it.
- **Consequence:** none beyond taste.
- **Scope:** introduced. **Cost:** trivial.
- **Source:** reviewer Suggestion; triage agrees.

## Aside

- `lib/ui/home.dart:4` calls `TokenService()` with no argument, but the constructor requires a `SecureStorage`. Pre-existing compile error, noticed while verifying; not a finding, not triaged.

## Handoff

| T | Finding | Why it still needs you | Proposed options |
|---|---------|------------------------|------------------|
| T1 | FINDING-04 | Is the timeout real on your runtime? | Investigate · Accept · Switch to async |
| T2 | FINDING-01 | Apply the guard now or accept the crash? | Fix · Accept |
| T4 | FINDING-05, -08 | Which fix shape do you want? | Keep the suffix · Drop it |
````

`<review scope>` is the branch, paths, or slug the review covered — not the `Scope` field of a verdict.

Before confirmation, `## Handoff` lists every entry whose resolution still needs a decision: all Necessary and Beneficial entries plus Needs your call. Defer and Discard never appear. After confirmation, reduce it to what is still open, and mark each confirmed or dropped entry at the top of its section. Docket consumes that section; it must not contain settled items. Omit `## Aside` when empty; it never affects the counts and never enters the Handoff.

## Confirming

Use one `AskUserQuestion` call with up to four questions:

1. **Necessary** — accept the set? Options: accept all, drop specific ids, promote something from Defer.
2. **Beneficial** — which to take? Options: all, specific ids, none.
3. **Defer and Discard** — anything to rescue? Options: nothing, or specific ids with a free-text reason.
4. **Needs your call** — only if that section is non-empty; ask each unresolved item as its own question, adjusting the option set to what the code supports. If there are more than four, ask the most consequential and leave the rest as explicit open questions in the file.

Keep the questions about sets and exceptions, not about individual findings. If a question can only be answered by re-reading the code, the finding should have been in Needs your call, not in a verdict.

After the answers arrive, apply the changes to the report and file, then ask one separate question about what happens next: **apply fixes**, **hand off to docket**, or **stop**. Never mix that action question into the confirmation batch; the action depends on the confirmed set.

## Applying

Only in apply mode, and only for items the user accepted.

- Fix one entry at a time, starting with Necessary. Stay inside each finding's file unless a caller change is required; say so when it is.
- One attempt per fix. If the linter or tests fail, revert or report the failure; do not spiral into a refactor.
- Run mechanical work (`D4`) through the tool, never by hand.
- Run the project's linter and tests at the end, then report which entries changed and which failed, using the source ids.

## Handing off to docket

Before confirmation, `## Handoff` lists every Necessary and Beneficial entry plus Needs your call, because each still needs a decision. Defer and Discard never appear. After confirmation, cut it to what is genuinely open: design-level Necessary items, accepted Beneficial items with more than one reasonable fix, and unresolved Needs your call. Docket opens them one at a time, treats confirmed verdicts as precedent, and never re-asks a settled one. Docket consumes that section; it must not contain settled items.

## Common mistakes

- Treating the reviewer's severity as the verdict. Severity is input; consequence in this change is the decision.
- Discarding without reading the code, or without a citation. If you cannot point at the refuting line, it goes to Needs your call.
- Calling a pre-existing severe bug Necessary. It goes to Defer with a latent flag; otherwise the diff grows every time someone reads the code.
- Calling a true but out-of-scope finding Discard. That hides real work; Defer is the honest bucket.
- Bucketing instances instead of causes, which inflates every count and buries the real problem in duplicates.
- Giving opposing findings separate verdicts, which leaves the user with two contradictory instructions.
- Asking about every finding. That is docket's job, and only after triage has removed the noise.
- Editing code during the triage pass, or applying fixes without an explicit choice.
- Printing the full evidence blocks in chat. The chat leads with verdicts; the file holds the reasoning.
- Writing a bare verdict rule where an entry id belongs, or the reverse. Entries are `T#`; verdict rules carry their name (`D1 Refuted`).
- Mixing the reviewer's rule id with the verdict rule. `vgv/force-unwrap` is the source; `N1` is the verdict.
- Inferring a report slug from an unrelated path when the findings were pasted. Use the branch slug.
- Using `D5` when the finding's stated premise is false. A false premise is `D1`, even when the recommendation happens to be reasonable anyway.
- Mixing findings and entries in the counts. Count entries, and say how many findings they came from.
