---
name: align
description: 'Build a shared, confirmed understanding of a task before work starts: restate the request as falsifiable claims, define the terms that carry weight, log where the two of you mean different things, and record the result in a brief file (docs/alignment/ by default). Use when the user says align, get on the same page, scope this, or do we mean the same thing, or before a large or ambiguous task where being wrong is expensive. Not for trivial requests with obvious scope.'
argument-hint: "[task description | brief path or directory]"
---

# Align

Reach a shared, written understanding of a task before any of it is built. Understanding runs in two directions: the agent must be able to state the user's idea correctly, and the user must be able to see and correct the agent's idea. A restatement the user politely agrees with is evidence of neither.

Alignment writes nothing except the brief. It does not edit code, and it produces no plan: no steps, no ordering, no estimates.

## When to use

- The user asks to align, get on the same page, scope something, or check that you mean the same thing.
- A task is large, ambiguous, expensive to undo, or uses vocabulary the two of you have not defined.
- A decision or a new term appears mid-task and the shared model may no longer hold. Re-align on the diff rather than starting over.

Do not use it for a one-line request with obvious scope or for a routine command. If the user invokes it explicitly, run it even on a small task.

## The three layers

Misalignment happens at three layers, and each needs a different test. Do not substitute one for another.

| Layer | What drifts | Test |
| --- | --- | --- |
| Referent | What is actually true: files, constraints, prior art | Read the primary source and cite it. Never ask the user what a file says. |
| Model | Each side's picture of the goal, scope, priorities and consequences | Restate as falsifiable predictions, not summaries |
| Language | What the words mean: "plugin", "done", "simple", "comprehensive" | A glossary entry with a definition, an example and a non-example |

A summary can be agreed to without being true. A prediction can be wrong, and a wrong prediction shows where the model diverges. Prefer predictions: "If my reading is right, we will not touch the existing triage skill" is a test; "you want a skill for alignment" is a mirror.

## Procedure

### 1. Pick the entry mode

- **Substantive request**: files, constraints, or more than about a sentence. Restate first (step 3).
- **Thin request**: one line, scope unclear. Ask 2-3 broad questions first, then restate. Restating first would anchor the user to your framing.
- **Existing brief**: the argument resolves to a file. Load it and re-align only on what changed (step 8).

Say which mode you are using in one sentence.

### 2. Gather before asking

Read what the repository and the conversation can answer: relevant files, prior turns, the diff, existing docs. Sort what you find into **known**, **checkable** and **unknown**. Resolve checkable items by checking them.

Ask the user only about unknowns: facts that live in their head, their intent, their priorities, and their tolerance for risk. On a substantive request, hold those questions until step 5 so the restatement comes first. On a thin request, step 1's broad questions come before the restatement, but only after this gathering pass.

Asking the user for a fact you could have read wastes their attention and signals that you have not engaged with the task.

### 3. Restate as numbered claims

Write one message with numbered claims, grouped under these headings:

- **Goal and why**: the outcome, and what prompted it now.
- **Who and what is affected**: the people, files, systems or workflows that change.
- **In scope**: what the work covers.
- **Out of scope**: non-goals you are guessing at. Mark guesses as guesses.
- **Constraints**: time, compatibility, conventions, and things that cannot change.
- **Success test**: how both of you will know it worked, stated so that it could fail.
- **Assumptions**: what you are taking for granted that has not been confirmed.
- **Terms I am unsure about**: words you suspect carry a private definition.

No questions in this message. End with: **"Which line is most wrong?"** Do not ask "does this look right?" A yes/no invitation gets a yes, and a yes confirms nothing about the individual claims.

### 4. Log every divergence

When the user replies, convert each correction, hesitation or new term into a row:

| Claim or term | My reading | Your reading | Status |
| --- | --- | --- | --- |
| "Comprehensive" | Covers every case | Covers the common cases, names what it omits | open |

Show the updated log before moving on. Never absorb a correction silently: the user needs to see that their words changed your model, and where. A correction that exists only in your head is indistinguishable from one you ignored.

### 5. Interrogate the open rows

Ask only about rows that are still open. Batch 2-4 related questions per round, in this priority order:

1. **Contested terms**: the same word doing two jobs.
2. **Unstated non-goals**: the work the user assumes you will not do.
3. **Success criteria**: what "done" means, in observable terms.
4. **Constraints that change the approach**: the ones that would make you choose differently.

For each question: the term or claim, why it matters, 2-4 concrete options, and your recommendation. Never batch questions where one answer changes the options for another. Answers arrive together, so later questions in the batch would be answered blind.

A batch is a prompt, not a ballot. The user may answer in prose, skip a question, answer a different one, or ask their own. Log a prose answer the same way as an option pick, and if the user says they would rather just talk, drop the options and continue free-form for that round.

After three rounds, present the rows that are still open and ask one question: keep grinding, or freeze with these flagged. If the user chooses to continue, ask again after each further round. The cap counts rounds, not questions.

Stop earlier when the next question would not change the work. That is the real stopping rule; the round cap only protects the user from an interrogation.

### 6. State your dissent

Before freezing, say plainly where you disagree, what you would do differently, and where your own reading is weakest. This is the half of alignment that confirmation rituals usually omit. Without it the user can correct their own idea but never yours, and the brief records agreement rather than understanding.

Do not manufacture disagreement to look independent, and do not suppress a real one to reach closure. If you have no dissent, say so, and say what would change your mind.

### 7. Freeze the brief

Write the brief to the resolved path, using [the brief template](references/brief-template.md). Then ask the user to confirm the file, not the chat summary. The summary and the file drift, and the file is what later work will cite.

Set `status: confirmed` in the frontmatter when the user confirms understanding. Leave it `draft` until then, including when some unknowns remain open. Quote any frontmatter value that contains a colon followed by a space, so a task sentence cannot break the YAML.

Keep three states separate, and record each one in the brief:

- **Understood**: you both mean the same thing by the same words.
- **Agreed**: the user approves the approach. Understanding does not imply approval.
- **Settled**: no open questions remain. This is often false. List what is open rather than claiming it.

Silence, "looks good", or a reply to a different question is not confirmation of every line.

### 8. Carry it forward

The brief's glossary becomes the project's vocabulary. Use those exact terms in later work, and when you notice yourself or the user reaching for a synonym, say so and use the defined term.

Re-align incrementally. When a new term appears, a decision surprises the user, or the scope moves, load the existing brief and run steps 4-7 on the diff. Do not rewrite a confirmed brief from scratch: append to the divergence log, update the affected sections, set `status: draft` again, then re-confirm.

## The brief file

Resolve the path in this order:

1. **An explicit path argument.** The whole argument is a path when it is a single token containing `/` or ending in `.md`, or when it names an existing file or directory. Anything else, including "update README.md", is a task description. An existing file is loaded as the brief to re-align. An existing directory gets the default filename appended. A path that does not exist is the write target, and its directory is created if needed. If the argument could be either, ask one clarifying question before writing. An explicit path beats the default.
2. **The default**: `docs/alignment/YYYY-MM-DD-<slug>.md`. Create `docs/alignment/` when it is missing, including for the default path. Take the slug from the ticket or branch name, dropping any type prefix (`feat/`, `fix/`) and replacing slashes with hyphens, so it stays one path segment. A branch that names no task (`main`, `master`, `develop`) is not a slug source. With no usable branch, use 3-6 kebab-case words from the goal.
3. **An existing brief for the same task**: list `docs/alignment/` and look for `*-<slug>.md` matching the current slug or branch before creating a new file. Update it in place rather than creating a second file.

The brief is not a plan. If it starts to contain steps, ordering or estimates, those belong in a plan document that cites the brief.

## Common mistakes

- Restating the request in the user's own words and calling that understanding. Add a prediction the user could falsify.
- Asking the user for facts the repository answers.
- Presenting a wall of claims and treating "looks good" as confirmation of every line.
- Burying a correction in a revised summary instead of logging it.
- Defining a term with a synonym, or with the term itself.
- Recording agreement as understanding, or understanding as approval.
- Writing the brief before the divergence pass. The draft anchors both sides.
- Letting the brief grow into a plan.
- Reaching the round cap and either silently continuing or silently stopping. Ask.
- Using the glossary once and then drifting back to synonyms. The terms are the contract.
