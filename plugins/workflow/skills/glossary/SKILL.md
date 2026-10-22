---
name: glossary
description: Build and maintain a shared, reviewed domain vocabulary in GLOSSARY.md so the user and the agent use the same words for the same things. Mines terms from the code or from named sources, hands only the conflicts (synonyms, overloaded terms, code and prose mismatches, stale code) to docket, and adds a pointer to the instruction file. Use for /glossary, when terminology drifts, or when the user wants a domain glossary.
argument-hint: "[path | topic]"
---

# Glossary

Build a shared vocabulary of domain terms in `GLOSSARY.md`, so one concept has one word and one word has one meaning, in the prose and in the code. The agent drafts; the user rules. Only entries the user has agreed to are binding.

The format is in [the entry format](references/entry-format.md). Read it before drafting or editing any entry.

## When to use

- The user and the agent use different words for the same thing, or one word for several things.
- Prose and code identifiers disagree.
- The user asks for a glossary, a ubiquitous language, or a shared vocabulary.
- A rerun to extend the glossary or to check it against the current code.

Do not use it to record decisions, specs, or notes, or to document framework or general programming concepts.

## Inputs

Use the first source that applies, and say which one you used.

1. **Explicit path or topic** from the argument.
2. **Non-code sources** the user supplied: pasted text or named documents. This makes it a non-code subject: no `_Code_:` lines and no code sweep.
3. **The repo root.** The glossary is `GLOSSARY.md` there.
4. **Otherwise,** ask one question.

If the repo's `GLOSSARY.md` already covers a different domain, ask for a path rather than mixing domains.

## Existing files

- If `GLOSSARY-MAP.md` exists, or `GLOSSARY.md` has no `**Term**:` entries, stop. Ask for a `GLOSSARY.md` path to write to, or cancel.
- Otherwise, parse the existing file and keep every header and section.

## Survey

1. **Load precedent.** Read the existing entries. Agreed entries are settled.
2. **Mine candidates.**
   - Sources: type and class names, enum values, tables, routes, modules, the README, docs, specs, and the conversation.
   - For large repos, run the sweep with the `Explore` agent.
   - The first survey drafts at most about 25 core concepts, ranked by how many layers they appear in. Say how many you left out. Reruns extend the set.
3. **Code sweep** (code subjects only).
   - A `_Code_:` name is missing if it is absent from every tracked source file. Exclude `GLOSSARY.md`, `AGENTS.md`, `CLAUDE.md`, `README*`, `docs/`, and other prose from this check.
   - Propose a successor only if `git log -S'<name>'` or the nearby code makes one obvious.
   - Each entry with missing names becomes one stale code item.
   - Never prune because a term is absent from the conversation or the docs. Never sweep a non-code glossary.
4. **Classify conflicts:** synonym, overloaded term, code-prose mismatch, undefined jargon, or stale code. A `proposed` entry can be part of a conflict.
5. **Rule on conflicts.** Hand the list to `workflow:docket` as an explicit list, one item per conflict, using the options in the ruling table of the entry format. Writing each ruling to `GLOSSARY.md` is docket's apply step, so the file is written after every batch.
6. **Re-validate.**
   - Remove relation targets that no longer resolve.
   - Reword any `proposed` definition that uses a word listed under `_Avoid_:` in an agreed entry, including entries agreed in this run.
7. **Confirm the clean set last.** Ask one AskUserQuestion covering every surviving entry that is still `proposed`.
   - The question body lists those entries, numbered, as term plus definition.
   - The options are **Accept all as agreed** and **Leave all proposed**.
   - Exceptions go through "Other", for example "all except 3, 7".
8. **Pointer.** See below.
9. **Report in chat:**
   - the file path;
   - how many entries were added, revised, and removed;
   - how many concepts were left out;
   - the conflicts that are still open.

Ask only about conflicts. Never ask about a term that has no conflict, and never ask about an agreed entry.

## During a session

Follow the pointer rules. When the user explicitly states or approves a term and its definition, write the entry as `agreed`. Write anything you inferred as `proposed`. Say in one line what you added. Write only terms, never decisions or notes.

## Pointer

The pointer puts the rules in front of every future session, including ones where this skill is not invoked.

- **Target file:** `CLAUDE.md`, unless it is absent or `@`-imports `AGENTS.md`; in those cases use `AGENTS.md`. Claude Code reads `AGENTS.md` when there is no `CLAUDE.md`, and reads only `CLAUDE.md` when both exist. If neither file exists, offer to create `AGENTS.md`. If the glossary is outside any repo, write no pointer and say so.
- **Detect first:** if the target file, or a file it imports, already mentions the glossary's path, do nothing. If a `## Domain vocabulary` heading already exists, add a path line under it.
- **Consent:** show the exact text and ask before writing. The pointer changes every future session's context.
- **Template:** a `## Domain vocabulary` section with one bullet per rule. This is the single home for the inline rules.
  - Glossary path.
  - Use canonical terms.
  - Never use a word under `_Avoid_:` in an agreed entry.
  - Flag a word that is used two ways.
  - Write new terms in the entry format, followed by one short example entry (a `**Term**:` line, a definition, and `_Status_: proposed`), so sessions that never load this skill can copy it.
  - Mark an entry `agreed` only on the user's explicit say-so.
  - Only `agreed` entries are binding.

## Common mistakes

- Marking an entry `agreed` on a passing mention.
- Pruning because a term is absent from the conversation.
- Asking about every term instead of only the conflicts.
- Putting anything but names in `_Code_:`.
