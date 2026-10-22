# Entry Format

The format of `GLOSSARY.md`: file structure, entry lines, status rules, the inclusion bar, and how each kind of conflict is ruled on. It is a superset of the domain-modeling `GLOSSARY.md` format, so a file written by either skill can be read by the other.

## File structure

````md
# Ordering

Receives and tracks customer orders.

## Language

**Order**:
A customer's confirmed request to buy one or more SKUs.
_Avoid_: purchase, cart (a cart is not yet an Order)
_Has_: Line Item, Payment
_Code_: `Order`, `orders` table
_Status_: agreed
````

- **New file:** `# {Context Name}` is the repo, product, or subject name, followed by one sentence of scope.
- **Placement:** write new entries into the section that holds the existing entries, either `## Language` or one of its `###` subheadings. Insert alphabetically if that section is sorted; otherwise append at the end of the section. This also applies to entries that a ruling creates or renames, such as the two halves of a split. Never re-sort the file and never add headings to an existing file.

## Entry lines

- **Identifier:** the canonical term, as `**Term**:`. Questions refer to entries by term, or by a numbered list in the question body.
- **Definition:** what the thing *is*, in one or two sentences. No behavior and no implementation detail.
- **`_Avoid_:`** other words used for this same concept. Never list another entry's term here; link the two entries with `_See also_:` instead.
- **Relations:** `_Is a_:`, `_Part of_:`, `_Has_:`, and `_See also_:`. Omit a relation when it is empty. Every target must be an entry in the file.
- **`_Code_:`** identifier names only: types, tables, enum values, routes. Omit it for non-code subjects.
- **`_Status_:`**
  - `proposed`: the agent drafted the entry.
  - `agreed`: the user explicitly stated or approved the term **and** its definition as written.
  - An entry with no status line, such as one written by another tool, counts as `proposed`.

Only `agreed` entries are binding. Agreed entries are precedent: do not reopen them. The one exception is a stale code item, which changes only `_Code_:`, the term's name, or whether the entry exists.

## Inclusion bar

- **Include** only terms specific to this project or subject.
- **Exclude** general programming concepts, framework terms, decisions, specs, and notes.

## Ruling table

Each conflict category has its own options and its own result. Docket allows 2-4 options per question:

- Give at most 4 candidates, or 3 when the question also offers Split.
- Send further candidates through the built-in "Other".
- Put each candidate's exact definition in the option's description, not in its label.
- A candidate's definition must not use any name that the same option moves to `_Avoid_:`.

| Category | Options | What a ruling writes |
| --- | --- | --- |
| Synonym, code-prose mismatch | Candidate canonical terms | The chosen term and definition, marked `agreed`. The losing names move to `_Avoid_:`. |
| Overloaded term | Candidate meanings for the word, plus **Split into two terms** | The chosen meaning keeps the word, marked `agreed`. A split creates two qualified terms as new `proposed` entries, each with the bare word under `_Avoid_:`. The bare word never goes under `_Avoid_:` while another entry uses it as its term. |
| Undefined jargon | Candidate definitions | The chosen definition, marked `agreed` |
| Stale code | **Update `_Code_`** (only when a successor was found), **Rename the term** (only when a successor was found), **Keep without the missing names**, **Remove the entry** (only when every name is missing) | Update replaces the missing names with the successor. Rename also changes the term and moves the old name to `_Avoid_:`. Keep drops the missing names, and drops `_Code_:` entirely if nothing is left. Remove deletes the entry. The status does not change. |

An "Other" answer that rewords a term or definition makes the entry `agreed`. Every ruling writes something, so the same item cannot come back on the next run.
