---
task: "One sentence describing the task."
date: YYYY-MM-DD
status: draft
---

# Task brief

## Goal

One sentence. State the outcome, not the activity. "A maintainer can audit an incoming dependency bump in under a minute" beats "add an audit skill".

## Why now

What prompted this, and what happens if it is not done.

## Affected

The people, files, systems or workflows that change, and the ones that must not.

## In scope

- What the work covers, stated as capabilities or changes rather than steps.

## Out of scope

- The non-goals both parties agreed on. Mark any that were inferred rather than stated.

## Glossary

| Term | Definition | Example | Non-example | Source |
| --- | --- | --- | --- | --- |
| Brief | The confirmed alignment document written before work starts. | A task whose scope, terms and success test are written down. | A plan with steps, ordering and estimates. | agent |

A term with no non-example is a slogan. Sharpen it or delete it. Keep definitions operational: one sentence that decides borderline cases.

## Constraints

| Constraint | Kind | Source |
| --- | --- | --- |
| Node 22 or later | fact | `ci.yml` |
| No new plugin manifest | assumption | Restatement, unconfirmed |

Facts carry a citation to the file, command or person that confirms them. Assumptions stay marked until someone checks.

## Assumptions

- What is being taken for granted, and what would falsify it.

## Success test

How both parties will know it worked, stated so that it could fail. Prefer an observable outcome over a feeling.

## Open unknowns

| Question | Cost if wrong | Owner |
| --- | --- | --- |
| Whether this ships as a skill or a plugin | An extra manifest and CI job | user |

An unknown with no cost is not worth asking. An unknown with a high cost is worth another round even past the cap.

## Divergence log

| Claim or term | My reading | Your reading | Status |
| --- | --- | --- | --- |
| "Comprehensive" | Covers every case a reviewer would raise | Covers the common cases and names what it omits | resolved |

Resolved rows stay. They are the record of what changed, and later work often needs to know why.

## Dissent

Where the agent disagrees, what it would do differently, and what would change its mind. "None" is valid only when it is true.

## Confirmation

- Understood: _yes/no_ — _YYYY-MM-DD_
- Agreed: _yes/no/not asked_ — _YYYY-MM-DD_
- Settled: _yes/no_ — _YYYY-MM-DD_
- Still open: _count and one-line list_
