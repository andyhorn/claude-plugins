# Verdict Rules

Every finding gets exactly one verdict: **Necessary**, **Beneficial**, **Defer**, or **Discard**. The rules below are applied in order and the first match wins. The rule id (for example `N1`) is the verdict's reason, and it is what the report cites. A verdict without a rule id is a guess.

## Two invariants

- **No Discard without a citation.** If you did not read the line that refutes the finding, you cannot dismiss it.
- **Necessary is scoped to this change.** A true, severe problem that predates the change is `Defer`, not `Necessary`. It still ships with a `latent` flag so it is not lost.

## Vocabulary

| Term | Means | Never confuse with |
|---|---|---|
| **Severity** | The reviewer's label: Critical, Important, Suggestion | The verdict |
| **Verdict** | What should happen to the finding now | How bad the problem is |
| **Scope** | Who is responsible: introduced, newly reachable, pre-existing, outside | Whether the finding is true |
| **Confidence** | Did you verify the claim against the code | How serious the consequence is |
| **Verdict rule** | The `D1`/`N3` id that justifies the verdict | The reviewer's rule id |
| **Source rule** | The reviewer's rule id, for example `vgv/force-unwrap` | The verdict rule |
| **Cost** | What the fix takes: trivial, moderate, design-level | The value of the fix |

The report keeps both rule ids: the source rule says what the reviewer looked for, and the verdict rule says what you decided. Group discards by verdict rule; the Signal line groups by source rule.

Severity is input, never output. Recompute consequence from the code; do not inherit the reviewer's label or their `why` text.

## Gate — verify before you rule

For each finding, before any rule applies:

1. **Restate it as a falsifiable claim.** "This is messy" is not a claim. "`parse()` accepts a unit suffix and returns a bare number" is. The source rule id is a label, not the claim: restate from the finding's title and body, and if the id and the claim disagree (say, `simplicity/inline-single-use` on a helper with two call sites), say so rather than inferring the claim from the id.
2. **Locate it.** Line numbers in a review go stale. Find the code by content, not by trusting the number.
3. **Read enough context to judge it.** Callers for contracts, tests for behavior, `git log` or `git blame` for age and scope.
4. **Record the outcome.** `confirmed`, `refuted`, or `can't tell`, each with a citation (`file:line`, a commit, or a decision record).
5. **If `can't tell`:** the finding goes to **Needs your call**. It does not get a verdict, and it is never discarded.

Verification is read-only. Triage never edits code.

## Discard

Findings that are not findings. Discard is the only verdict that requires high confidence.

### D1 · Refuted

The code does not do what the claim says. Cite the line that proves it.

A false premise is `D1`, even when the recommendation would still be reasonable. If the finding says "single-use helper" and there are two call sites, refute it: the finding as written is wrong, and the user should know the reviewer's analysis was wrong.

Example: a reviewer says a lock is never released; the `finally` block on the next line releases it.

### D2 · Redundant

A duplicate of another finding in the same list, already fixed on this branch, or resolved by a decision already made. Point to the duplicate, the commit, or the decision.

Cluster duplicates during grouping, so this rule mostly catches cross-source repeats and stale reports.

### D3 · Intentional

The behavior is deliberate: a documented decision, a comment explaining the trade-off, a spec, or the user's own instruction. Cite the evidence.

**Exception:** correctness, security, and data loss outrank intent. In those cases the verdict is `N1`, and the report carries a conflict flag: `intentional per <evidence>, but has a <consequence> — confirm`.

### D4 · Mechanical

A linter, formatter, or CI rule already enforces the finding, and the tool is wired into the gate. This is not a decision: run the tool. Wired means the command actually runs in CI. A rule the project documents but never runs is not wired. When the docs assert CI runs a standard tool, treat it as wired; when they name a custom checker that does not exist, that is not enforcement.

Record the tool action as an action, not a docket item, and name the tool to run in the chat line. If the tool is not wired into the gate, `D4` does not apply — the finding is real, and `N3` or `B1` decides it.

### D5 · Preference

No behavioral, contractual, or task consequence, and no near-term maintenance consequence. This covers taste beyond project config, speculative future needs ("what if we need this later"), and abstractions the code does not need yet.

The test: can you name a concrete scenario that gets worse if the code stays as it is? If not, it is `D5`.

### D6 · Not this code

The finding is about code this change does not touch, or the proposed fix is a rewrite that would balloon the diff. This rule routes rather than rules: a valid issue goes to `F1` or `F3`; only a request with no consequence beyond taste is `Discard`.

## Necessary

The default verdict when deciding is hard. Necessary must mean "this change is not done without it" — not "this matters in general".

All five rules require scope `introduced` or `newly reachable`, or a fix entirely inside hunks this change already modifies and trivial in cost. Adjacent untouched lines do not count: a one-token fix one line above the diff is still pre-existing, and a small fix does not make a finding `Necessary`. A finding that fails the scope test cannot be `Necessary`; it goes to `Defer`.

### N1 · Breaks behavior

Wrong output, crash, unhandled error path, data loss or corruption, race condition, security hole, authentication bypass, or secret leak. Name the failing scenario; "could be a problem" is not enough.

### N2 · Breaks a contract

A public API, type, schema, protocol, or persisted format changes in a way that breaks existing callers, stored data, or an unsafe migration. Backward incompatibility counts even when no current caller is visible in the repository.

### N3 · Fails the gate

The build, typecheck, test suite, or CI-enforced lint fails. Distinguish a test that actually runs and fails from one that does not exist; a missing test is `B1`, not `N3`, unless the project's gate requires it. A gate requirement counts only when the check actually runs: a documented checker whose script is absent is documentation, not enforcement, so treat the finding as `B1` unless the user confirms the gate.

`N3` requires the gate to pass at base and fail now. A gate already red at base is `F1` with `latent: critical` and a `gate red at base` note: the change did not cause it, but the branch still cannot merge until it is fixed.

### N4 · Violates the task

The change contradicts an explicit specification, acceptance criterion, user instruction, or a documented invariant in `AGENTS.md`, `CLAUDE.md`, or the project's rules. A style preference in a style guide is not `N4` unless the project treats it as binding.

### N5 · Unrecoverable later

Cheap now, expensive or impossible after ship: data migrations, released public APIs, persisted formats, security surfaces, telemetry contracts. The cost asymmetry is the rule; the finding itself may be small.

## Defer

True and potentially worth doing, but not this change's problem. Defer is not a soft discard: every deferred item is listed with its severity and can be turned into follow-up work.

### F1 · Pre-existing

Predates the change and the change does not worsen it. Mark `latent: critical | important | minor` from the consequence, not the reviewer's label. If the two disagree, use the consequence and show the disagreement. Sort latent items by consequence so a severe one is not buried. A gate that is already red at base carries a `gate red at base` note so nobody blames this change for it.

If the change makes a pre-existing issue reachable, the scope is `newly reachable`, so this rule does not apply — go back to `Necessary`.

### F2 · Bigger than the change

Needs a design decision, a cross-cutting refactor, or coordination with other work. Valid, but not a review finding's size.

### F3 · Out of scope

Explicitly excluded by the task, the user, or the review's stated scope. Cite the exclusion.

### F4 · Cost > value now

The fix is real but the effort, risk, or blast radius outweighs the benefit at this point. State the cost; "not worth it" without an estimate is `D5`.

## Beneficial

Valid, in scope, and worth doing — the default for anything the rules above did not claim.

### B1 · Cheap and material

A concrete improvement in touched code: dead code introduced here, a misleading name with a named failure scenario, a missing error path, a missing test for new behavior, logic duplicated by this change, a comment that now lies.

### B2 · Local consistency

Diverges from an established pattern in the surrounding touched code, where matching the pattern removes a real source of confusion. Divergence from a pattern the change did not touch is `D5`.

### B3 · Risk removal

A cheap change that deletes a plausible bug class: replacing a stringly-typed argument, narrowing a loose type at a boundary, adding an assertion where a silent fallback currently hides errors.

## Precedence

Apply in this order, first match wins:

1. **Gate** — unverifiable goes to Needs your call.
2. `D1`, `D2` — false or already settled; nothing else matters.
3. `D3` — intentional, unless safety.
4. `D4` — mechanical.
5. `D5`, `D6` — preference, or not this code.
6. `N1`–`N5` — necessary, subject to the scope test.
7. `F1`–`F4` — valid but not now.
8. `B1`–`B3` — default for the remainder.

Two rules can appear to match at once. Resolve them this way:

- A deliberate design choice that leaks secrets is `N1`, not `D3`.
- A lint finding that CI enforces is `D4`, not `N3` — the fix is running the tool, not deciding.
- A false premise is `D1`, even when the recommendation would still be defensible.
- A finding about an untouched line is `F1` even when the fix is one token. Locality only breaks ties inside hunks the change already modifies.
- A missing test is `B1`; a failing test is `N3`.
- A pre-existing severe bug is `F1` with a latent flag; it is never `N1`.
- A finding about untouched code is `F1`/`F3` if valid, `D6` only when it is also taste.

## Confidence

| Level | Test | Allowed verdicts |
|---|---|---|
| **High** | Read the exact code; the failure scenario or refutation is concrete | Any |
| **Medium** | Read the code, but the consequence depends on an unconfirmed caller or runtime assumption | Necessary (flagged), Beneficial, Defer |
| **Low** | Could not locate the code, intent is ambiguous, or the line is stale | None — Needs your call |

Additional rules:

- **Discard requires high confidence.** A refutation you are not sure of is a question, not a verdict.
- **Necessary may stand on medium confidence**, but the report flags it for verification. Never auto-apply a medium-confidence Necessary item without saying so.
- **A stale line is not a refutation.** Re-locate by content. If the code is gone, use `D2`; if you cannot tell whether the concern was addressed, use Needs your call.

## Worked examples

**Force-unwrap in new code.** `token!.value` on a path where the token can be null. Scope: introduced. → `N1`, high. The fix is a guard, and shipping it crashes.

**Pre-existing null dereference in a touched function.** The diff adds a call two lines above it, but the dereference itself is unchanged and not made reachable. → `F1`, high, `latent: critical`. Not `N1`: fixing it would grow this change, and calling it discardable would hide it.

**Missing test for a new cubit.** The project's gate requires a test file per cubit. → `N3`. If the gate does not require it, the same finding is `B1` — real, cheap, and worth doing. If the cubit predates the change and the gate is already red at base, → `F1` with `latent: critical` and a `gate red at base` note.

**A three-line wrapper used twice.** The reviewer's stated reason is that it is single-use; there are two call sites. → `D1 Refuted`, because the premise is false. If the reviewer instead argues the wrapper adds a hop and names no misuse scenario, → `D5`. Either way, the test is: would you accept this as a follow-up commit from a colleague? If it is only acceptable because it is already written, discard it.

**Two agents disagree: extract a helper vs. inline it.** One entry, not two verdicts. Neither side names a consequence. → `D5`, one decision, and say the reviewers contradict each other.

**A deliberate no-validation path.** A comment says input is validated upstream, and the caller does validate. → `D3`. If the caller's validation has a hole that lets unvalidated input through, → `N1` with a conflict flag.

**A lint rule that is not in CI.** The reviewer cites a rule the project documents but never runs. → `B1`, not `D4`, because running the tool will not catch it.

## Calibration

- **Necessary test:** would you name it in the PR description as a known issue you are shipping? If not, it is not `Necessary`.
- **Beneficial test:** would you accept this as a follow-up commit from a colleague? If only because it is already written, it is `D5`.
- **Discard test:** can you point at the line, commit, or decision that settles it? If not, it is Needs your call.
- **Distribution check:** if almost everything is Discard, look for a rule class you are rationalizing away. If almost everything is Necessary, you are grading the reviewer's effort, not the change.
