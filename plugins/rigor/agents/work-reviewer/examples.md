# Calibration examples for `rigor:work-reviewer`

Use these cases to keep acceptance-gate scoring, severity tags, and the correctness / polish split consistent. They are anchors, not exact recipes.

## Case 1: Acceptance gate passes, only polish remains

**Task:** "Add a unit test for `parseDate` and update the helper so it rejects empty strings."

**Deliverable:** a test file, a helper change, and `npm test` output.

### Case 1 acceptance checklist

1. A unit test for `parseDate` exists — **MET**
2. Empty strings are rejected by the helper — **MET**
3. Existing tests still pass — **MET**

### Case 1 claims

1. "I added `parseDate.test.ts` with two cases." — **VERIFIED** from deliverable file list.
2. "`parseDate('')` now throws." — **VERIFIED** from the test output.
3. "`npm test` passes." — **VERIFIED** from the caller's verbatim output.

### Case 1 deductions

- [ADVISORY] 2 — Scope and simplicity — one test duplicates coverage already present in `date.test.ts`.
- [ADVISORY] 3 — Clarity and maintainability — helper name is fine, but the error message is cryptic.

### Case 1 result

- Correctness: 75/75
- Polish: 13/25
- **Total: 88/100**
- **Acceptance gate: PASS** (all requirements MET, all claims VERIFIED, no [BLOCKING] deductions).

---

## Case 2: Missing acceptance criterion

**Task:** "Document the new `--format` flag in README.md and add a usage example."

**Deliverable:** README.md updated with a description of `--format` but no example command.

### Case 2 acceptance checklist

1. Document the `--format` flag in README.md — **MET**
2. Add a usage example — **NOT MET**

### Case 2 claims

1. "I added a usage example." — **REFUTED** by reading `README.md`; no example block exists.

### Case 2 deductions

- [BLOCKING] 25 — Requirements met — explicit requirement 2 is NOT MET; add the example.
- [ADVISORY] 3 — Clarity and maintainability — README formatting is inconsistent.

### Case 2 result

- Correctness: 50/75
- Polish: 12/25
- **Total: 62/100**
- **Acceptance gate: FAIL** (requirement NOT MET and a REFUTED claim).

---

## Case 3: Refuted claim, plus a polish nit

**Task:** "Copy-edit the plugin description in `plugin.json`."

**Deliverable:** `plugin.json` is changed, but a JSON key is misspelled.

### Case 3 acceptance checklist

1. Update the plugin description in `plugin.json` — **MET**

### Case 3 claims

1. "I updated the description in `plugin.json`." — **VERIFIED** from the file diff.
2. "All JSON keys are valid." — **REFUTED**: `descrition` is misspelled.

### Case 3 deductions

- [BLOCKING] 25 — Claims verified — claim 2 is REFUTED; fix the typo.
- [ADVISORY] 2 — Clarity and maintainability — description could be one sentence shorter.

### Case 3 result

- Correctness: 50/75
- Polish: 8/25
- **Total: 58/100**
- **Acceptance gate: FAIL** (REFUTED claim).
