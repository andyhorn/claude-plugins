---
title: "feat: add workflow glossary skill"
type: feat
date: 2026-10-21
---

## feat: add workflow glossary skill

## Context

The user and the agent drift apart on domain words. One concept ends up with two words ("order" and "purchase"). One word covers several concepts ("account"). Or the prose disagrees with the code identifiers. The goal is a skill that builds and maintains a **shared, reviewed vocabulary**, so both sides use the same words for the same things across sessions.

### Prior art

The prior art is Matt Pocock's `domain-modeling` skill: `mattpocock/skills`, `skills/engineering/domain-modeling/`, MIT licensed. According to that repo's CHANGELOG, it replaced his `ubiquitous-language` skill.

- **What it writes:** a root `GLOSSARY.md`, structured as `# {Context Name}`, then a description, then `## Language`, then the entries. Each entry is a `**Term**:` line, a definition, and an `_Avoid_:` line.
- **Failure modes in his docs** (`docs/engineering/domain-modeling.md`), and how this design answers them:
  - **Implementation-detail bloat:** an inclusion bar and a cap on the first survey.
  - **Weak auto-invocation:** a pointer in AGENTS.md or CLAUDE.md that carries the rules.
  - **50+ questions on brownfield repos:** mine the terms first; the user rules only on conflicts.
  - **Unreviewed agent-written glossaries:** a `proposed`/`agreed` status, where only `agreed` is binding.
  - **Settled disputes raised again:** agreed entries act as precedent.
- **Reuse:** no text is copied from his skill. The *format* is reused on purpose so the two skills interoperate, and the README credits it.
- **Known tension:** his guidance keeps implementation detail out of the glossary entirely. Our `_Code_:` line lists identifier **names only**, which is how mismatches between code and prose get detected.

## Decisions (user)

| Decision | Choice |
| --- | --- |
| Domain | Both, codebase first. A non-code subject draws its terms from the conversation and from sources the user names, and has no `_Code_:` line. |
| Shape | Glossary plus typed relations |
| Format | A superset of Pocock's format, both the file structure and the entry lines |
| Persistence | `GLOSSARY.md` at the repo root, plus a pointer in the instruction file |
| Process | Mine the terms first; the user rules on conflicts through `workflow:docket` |
| Lifecycle | A rerun merges into the existing file, with agreed entries as precedent. No drift-check mode. |
| Approach | A survey pass plus inline discipline |
| Name | `/workflow:glossary` |

Out of scope: a drift-check or lint mode, writing `GLOSSARY-MAP.md`, converting foreign-format files, ADRs, hooks, and new tests.

## Files

| File | Change |
| --- | --- |
| `plugins/workflow/skills/glossary/SKILL.md` | New. Contains the procedure, the pointer, and the common mistakes. |
| `plugins/workflow/skills/glossary/references/entry-format.md` | New. Contains the file structure, the entry lines, the status rules, the inclusion bar, and the ruling table. SKILL.md links to it by relative path, which the existing link test checks. This follows `triage/references/verdict-rules.md`. |
| `plugins/workflow/skills/docket/SKILL.md` | Add one sentence to step 1 saying that a list the caller passes explicitly (as an argument or in chat) takes precedence over the triage report lookup. |
| `plugins/workflow/.claude-plugin/plugin.json` | The description mentions glossary. **Do not bump the version.** release-please owns it. |
| `.claude-plugin/marketplace.json` | Use the same description as `plugin.json` and add a `glossary` tag. Keep the `tags` array expanded one item per line (the file is in `.prettierignore`). **Do not bump the version.** |
| `docs/plan/2026-10-21-feat-workflow-glossary-plan.md` | New. This plan, with `title`/`type`/`date` frontmatter like `docs/plan/2026-10-09-feat-deps-triage-plugin-plan.md`. It must pass markdownlint, which means no bold-as-heading (MD036). |
| `README.md` | Add `/workflow:glossary` to the workflow row. Add a separate sentence under the table crediting Pocock's format, linking `https://github.com/mattpocock/skills`, matching the existing rigor credit. |

## `references/entry-format.md`

### File structure

The file uses Pocock's structure:

```md
# Ordering

Receives and tracks customer orders.

## Language

**Order**:
A customer's confirmed request to buy one or more SKUs.
_Avoid_: purchase, cart (a cart is not yet an Order)
_Has_: Line Item, Payment
_Code_: `Order`, `orders` table
_Status_: agreed
```

- **New file:** the `# {Context Name}` is the repo, product, or subject name, followed by one sentence of scope.
- **Placement**, stated once here; SKILL.md refers to this:
  - Write new entries into the section that holds the existing entries: `## Language` or one of its `###` subheadings.
  - Insert alphabetically if that section is sorted; otherwise append at the end of the section.
  - Never re-sort the file and never add headings to an existing file.

### Entry lines

- **Identifier:** the canonical term (`**Term**:`). Questions refer to entries by term, or by a numbered list in the question body.
- **Definition:** what the thing *is*, in 1–2 sentences. No behavior and no implementation detail.
- **`_Avoid_:`** rejected synonyms.
- **Relations:** `_Is a_:`, `_Part of_:`, `_Has_:`, and `_See also_:`. Omit a relation when it is empty. Every target must be an entry in the file.
- **`_Code_:`** identifier names only. Omit it for non-code subjects.
- **`_Status_:`**
  - `proposed` means the agent drafted the entry.
  - `agreed` means the user explicitly stated or approved the term **and** its definition as written.
  - An entry with no status line, such as one written by Pocock's skill, counts as `proposed`.

### Inclusion bar

- **Include** only terms specific to this project or subject.
- **Exclude** general programming concepts, framework terms, decisions, specs, and notes.

### Ruling table

Each conflict category has its own options and its own result. Docket allows 2–4 options:

- Give at most 4 candidates, or 3 when the question also offers Split.
- Further candidates go through the built-in "Other".
- Put each candidate's exact definition in the option's description, not in its label.

| Category | Options | What a ruling writes |
| --- | --- | --- |
| Synonym, overloaded term, code↔prose mismatch | Candidate canonical terms. An overloaded term also gets **Split into two terms**. | The chosen term and definition, marked `agreed`. The losing names move to `_Avoid_:`. A split creates new `proposed` entries. |
| Undefined jargon | Candidate definitions | The chosen definition, marked `agreed` |
| Stale code | **Update `_Code_`** (only when a successor was found) · **Rename the term** (only when a successor was found) · **Keep without the missing names** · **Remove the entry** (only when every name is missing) | Update replaces the missing names with the successor. Rename also changes the term and moves the old name to `_Avoid_:`. Keep drops the missing names, and drops `_Code_:` entirely if nothing is left. Remove deletes the entry. The status does not change. |

An "Other" answer that rewords a term or definition makes the entry `agreed`. Every ruling writes something, so the same item cannot come back on the next run.

## `SKILL.md`

Model `SKILL.md` on `triage/SKILL.md`.

### Frontmatter

- `description` is a single line of 61–1024 characters. The `fieldOf` helper in `test/workflow/skills.test.mjs` cannot parse folded YAML.
- `argument-hint: "[path | topic]"`.

### Sections

#### When to use

#### Inputs

Use the first source that applies, and say which one you used:

1. An explicit path or topic.
2. Non-code sources the user supplied (pasted text, named documents). These make it a non-code subject.
3. The repo root.
4. Otherwise, ask one question.

If the repo's `GLOSSARY.md` already covers a different domain, ask for a path rather than mixing domains.

#### Existing files

- If `GLOSSARY-MAP.md` exists, or `GLOSSARY.md` has no `**Term**:` entries, stop. Ask for a `GLOSSARY.md` path to write to, or cancel.
- Otherwise, parse the existing file and keep every header and section.

#### Survey

1. **Load precedent.** Read the existing entries. Agreed entries are settled.
2. **Mine candidates.**
   - Sources: type and class names, enum values, tables, routes, modules, README, docs, specs, and the conversation.
   - For large repos, run the sweep with the `Explore` agent.
   - **The first survey drafts at most about 25 core concepts**, ranked by how many layers they appear in. Say how many you left out. Reruns extend the set.
3. **Code sweep** (code subjects only).
   - A `_Code_:` name is **missing** if it is absent from every tracked source file. Exclude `GLOSSARY.md`, `AGENTS.md`, `CLAUDE.md`, `README*`, `docs/`, and other prose from this check.
   - Propose a successor only if `git log -S'<name>'` or the nearby code makes one obvious.
   - Each entry with missing names becomes one **stale code** item.
   - Never prune because a term is absent from the conversation or the docs. Never sweep a non-code glossary.
4. **Classify conflicts:** synonym, overloaded term, code↔prose mismatch, undefined jargon, or stale code. A `proposed` entry can be part of a conflict.
5. **Rule on conflicts.** Hand the list to `workflow:docket` as an explicit list, one item per conflict, using the options in the ruling table. Writing the rulings to `GLOSSARY.md` is docket's "apply the decisions" step (docket step 7), so the file is written after every batch.
6. **Re-validate.** Remove relation targets that no longer resolve.
7. **Confirm the clean set last.** Ask one AskUserQuestion that covers every surviving entry that is still `proposed`.
   - The question body lists those entries, numbered, as term plus definition.
   - The options are **Accept all as agreed** and **Leave all proposed**.
   - Exceptions go through "Other", for example "all except 3, 7".
8. **Pointer** (see below).
9. **Chat report:**
   - the file path;
   - how many entries were added, revised, and removed;
   - how many concepts were left out;
   - the conflicts that are still open.

#### During a session

Follow the pointer rules. When the user explicitly states or approves a term and its definition, write the entry as `agreed`. Write anything you inferred as `proposed`. Say in one line what you added. Write only terms, never decisions or notes.

#### Pointer

- **Target file:** `CLAUDE.md`, unless it is absent or `@`-imports `AGENTS.md`. In those cases, use `AGENTS.md`. Claude Code loads only `CLAUDE.md` when both exist (code.claude.com/docs/en/memory). If neither file exists, offer to create `AGENTS.md`. If the glossary is outside any repo, write no pointer and say so.
- **Detect first:** if the target file, or a file it imports, already mentions the glossary's path, do nothing. If a `## Domain vocabulary` heading already exists, add a path line under it.
- **Consent:** show the exact text and ask before writing. The pointer changes every future session's context.
- **Template:** a `## Domain vocabulary` section with one bullet per rule. This is the single home for the inline rules:
  - Glossary path.
  - Use canonical terms.
  - Never use a word under `_Avoid_:` in an agreed entry.
  - Flag a word that is used two ways.
  - Write new terms in the entry format; include one example line.
  - Mark an entry `agreed` only on the user's explicit say-so.
  - Only `agreed` entries are binding.

#### Common mistakes

Keep only the non-obvious ones:

- Marking an entry `agreed` on a passing mention.
- Pruning because a term is absent from the conversation.
- Asking about every term instead of only the conflicts.
- Putting anything but names in `_Code_:`.

## Sequencing

1. **Stack on triage.** Branch `feat/workflow-glossary` from `feat/workflow-triage` (PR #29) in an isolated worktree at `../claude-plugins-glossary`. The glossary PR targets `feat/workflow-triage`. After #29 merges, rebase onto `origin/main` and retarget the PR to `main`. If release-please's release PR merges first, expect a trivial rebase on the version lines.
2. **Build.** Dispatch the `builder` agent in that isolated worktree as a single worker. Give it this plan and verification steps 1–6. The builder does not run the dry run.
3. The main session reviews the diff.
4. Commit, with the user's approval, so that verification and the dry-run clone see committed content.
5. Run the behavioral dry run with the user.
6. Run `grade-loop` on the built skill.
7. Open the PR titled `feat(workflow): add glossary skill`. The PR body must call out the docket precedence change, because the squash-merge changelog shows only the title.

## Verification

### Automated

These mirror CI. `test-runner` reports the output verbatim. Run them after the commit; codespell and the link check read `git ls-files`.

1. `node --test test/deps/*.test.mjs test/rigor/*.test.mjs test/workflow/*.test.mjs`
2. `npx --yes @anthropic-ai/claude-code@2.1.295 plugin validate --strict .`, then the same for `./plugins/workflow`. 2.1.295 is the CI pin.
3. `npx --yes markdownlint-cli2@0.18.1` and `npx --yes prettier@3.6.2 --check '**/*.json'`
4. `node -e "JSON.parse(require('fs').readFileSync('.claude-plugin/marketplace.json','utf8'))"`. Prettier skips this file.
5. `git ls-files '*.md' -z | xargs -0 -n1 npx --yes markdown-link-check@3.13.7 -q -c .github/markdown-link-check.json`
6. `git ls-files -z -- . ':!test/deps/fixtures' | xargs -0 uvx codespell@2.4.1`

Gitleaks runs in CI only; it is not installed locally.

### Behavioral dry run

The user drives the session. The main session sets up the clone and checks the files and diffs.

Before you start, disable the installed `workflow@andyhorn` plugin through `/plugin`, and re-enable it afterward. Reported bugs say `--plugin-dir` can lose to an installed plugin with the same name. `SCRATCH` is this session's scratchpad.

```sh
REPO=<path to claude-plugins>
git clone --branch feat/workflow-glossary "$REPO" "$SCRATCH/glossary-dry" && cd "$SCRATCH/glossary-dry"
mkdir -p docs/code-review/feat-workflow-glossary   # triage slug rule: '/' → '-'
# write a stub triage.md there with a ## Handoff section listing one fake item
claude --plugin-dir ./plugins/workflow
```

0. **Load check.** `/workflow:glossary` is listed.
1. **First run.**
   - At most about 25 entries.
   - The file has the `# … / ## Language` structure.
   - Docket gets the glossary conflicts, not the triage stub. Each question has at most 4 options, with the definitions in the descriptions.
   - The file is written after each batch, and the clean-set question comes last.
   - The pointer needs consent before it is written.
2. **Rerun.** First run `cp GLOSSARY.md before.md`. Check that:
   - The agreed entries are byte-identical under `diff`.
   - No question is asked about an agreed entry.
   - No duplicate pointer is written.
3. **Stale code.**
   - Rename one `_Code_:` identifier and commit. The rerun offers Update or Rename with the successor.
   - Delete every identifier of a different entry. The rerun offers Remove.
4. **Foreign entry.** Add a Pocock-style entry with no `_Status_:`. The rerun includes it in the clean-set question as `proposed`.
5. **Non-code subject.** Paste text. Expect no `_Code_:` lines, no sweep, and a question asking for a path, because `GLOSSARY.md` already holds the code domain.

### Accepted risks

- Whether the inline discipline works in sessions that have only the pointer cannot be measured before shipping. Check informally after a few real sessions.
- The dry run is a single stochastic sample.
- On 2.1.296, whether `--plugin-dir` takes precedence over an installed plugin is unconfirmed; that is why the installed plugin is disabled for the dry run.
