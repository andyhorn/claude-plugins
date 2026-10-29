import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const rules = readFileSync(
  new URL('../../plugins/rigor/rules.md', import.meta.url),
  'utf8',
);
const skill = readFileSync(
  new URL('../../plugins/rigor/skills/grade-loop/SKILL.md', import.meta.url),
  'utf8',
);
const reviewer = readFileSync(
  new URL('../../plugins/rigor/agents/work-reviewer.md', import.meta.url),
  'utf8',
);
const examples = readFileSync(
  new URL('../../plugins/rigor/agents/work-reviewer/examples.md', import.meta.url),
  'utf8',
);

describe('work-reviewer agent format', () => {
  it('tags every deduction as [BLOCKING] or [ADVISORY]', () => {
    assert.match(reviewer, /^\s*- \[BLOCKING\]/m);
    assert.match(reviewer, /^\s*- \[ADVISORY\]/m);
  });

  it('caps MUST-FIX at the mode\'s [MUST-FIX] cap from rules.md', () => {
    assert.match(reviewer, /mode's \[MUST-FIX\] cap/i);
    assert.match(reviewer, /at most.*highest-impact \[BLOCKING\] deductions/i);
    assert.doesNotMatch(reviewer, /at most 3 highest-impact \[BLOCKING\] deductions/);
    assert.match(reviewer, /MUST-FIX.*never contains.*\[ADVISORY\]/i);
  });

  it('lets only [BLOCKING] deductions prevent a pass', () => {
    assert.match(reviewer, /Only \[BLOCKING\] deductions can cause the acceptance gate to fail/i);
    assert.match(reviewer, /Any \[BLOCKING\] deduction: the acceptance gate FAILS/i);
  });
});

describe('work-reviewer review journal', () => {
  it('reads a Review Journal section in the packet', () => {
    assert.match(reviewer, /Review journal/i);
    assert.match(reviewer, /fixed.*pending.*dismissed/i);
  });

  it('does not re-report fixed or dismissed deductions', () => {
    assert.match(
      reviewer,
      /Do not list a `fixed` or `dismissed` deduction again|must not be reported again|must not be re-reported/i,
    );
  });

  it('can report pending deductions if they are still present', () => {
    assert.match(reviewer, /`pending` deduction.*still present/i);
  });
});

describe('grade-loop skill stop conditions', () => {
  it('passes only when the acceptance gate is PASS', () => {
    assert.match(skill, /acceptance gate \*\*PASS\*\*.*mode's pass threshold/i);
  });

  it('passes with no [BLOCKING] deductions at the mode\'s pass threshold', () => {
    assert.match(
      skill,
      /total score at or above the mode's pass threshold.*no \[BLOCKING\] deductions remain.*MUST-FIX list is empty/i,
    );
  });

  it('does not anchor the pass on a fixed 85 or 90 threshold', () => {
    assert.doesNotMatch(skill, /score (85|90) or more with an empty MUST-FIX/);
    assert.doesNotMatch(skill, /score (85|90) or more.*no \[BLOCKING\] deductions/);
  });

  it('stops early on progress when the score rose and only advisory/uncertain items remain', () => {
    assert.match(skill, /score rose since the previous round/i);
    assert.match(skill, /no \[BLOCKING\] deductions remain/i);
    assert.match(skill, /only \[ADVISORY\] or `UNCONFIRMED` items are left/i);
  });

  it('reworks when any [BLOCKING] item remains', () => {
    assert.match(skill, /any \[BLOCKING\] item remains.*rework/i);
  });
});

describe('grade-loop review journal', () => {
  it('maintains a cross-round review journal', () => {
    assert.match(skill, /review-journal\.md/);
    assert.match(skill, /## Round <n>/i);
  });

  it('records fixed, pending, and dismissed statuses', () => {
    assert.match(skill, /fixed \/ pending \/ dismissed/i);
    assert.match(skill, /`fixed`[\s\S]*`pending`[\s\S]*`dismissed`/i);
  });

  it('prohibids re-introducing fixed deductions', () => {
    assert.match(skill, /fixed or dismissed deduction.*must not be re-reported/i);
    assert.match(skill, /A fixed or dismissed deduction.*must not be re-reported/i);
  });
});

describe('grade-loop escalation', () => {
  it('lets the main agent ask the user about a [BLOCKING] MUST-FIX', () => {
    assert.match(skill, /ask the user whether to dismiss that item/i);
    assert.match(skill, /escalation|escalate/i);
  });
});

describe('work-reviewer acceptance gate', () => {
  it('marks every requirement as MET, PARTIAL, or NOT MET', () => {
    assert.match(reviewer, /MET \| PARTIAL \| NOT MET/i);
  });

  it('marks every claim as VERIFIED, REFUTED, or UNCONFIRMED', () => {
    assert.match(reviewer, /VERIFIED \| REFUTED \| UNCONFIRMED/i);
  });

  it('requires every requirement MET to pass', () => {
    assert.match(reviewer, /every requirement.*MET/i);
    assert.match(reviewer, /Any requirement.*NOT MET.*acceptance gate FAILS/i);
  });

  it('requires every claim VERIFIED and no REFUTED claims to pass', () => {
    assert.match(reviewer, /every claim.*VERIFIED/i);
    assert.match(reviewer, /no REFUTED claims/i);
  });

  it('fails the acceptance gate for any [BLOCKING] deduction', () => {
    assert.match(reviewer, /Any \[BLOCKING\] deduction: the acceptance gate FAILS/i);
  });
});

describe('work-reviewer correctness / polish split', () => {
  it('splits correctness into a 0-75 gate', () => {
    assert.match(reviewer, /Correctness gate \(0-75/i);
  });

  it('splits polish into a 0-25 score', () => {
    assert.match(reviewer, /Polish score \(0-25/i);
  });

  it('tags polish deductions as [ADVISORY] only', () => {
    assert.match(reviewer, /Polish deductions are always \[ADVISORY\]/i);
    assert.match(reviewer, /no polish item is ever \[BLOCKING\]/i);
  });

  it('lets polish lower the total but not block a pass by itself', () => {
    assert.match(reviewer, /no polish item is ever \[BLOCKING\]/i);
  });
});

describe('work-reviewer calibration examples', () => {
  it('has a non-empty examples file', () => {
    assert.ok(examples.length > 0);
  });

  it('includes calibration cases', () => {
    assert.match(examples, /Case 1:/i);
    assert.match(examples, /Case 2:/i);
    assert.match(examples, /Case 3:/i);
  });

  it('anchors scoring with PASS/FAIL acceptance gates', () => {
    assert.match(examples, /Acceptance gate: PASS/i);
    assert.match(examples, /Acceptance gate: FAIL/i);
  });

  it('is referenced by the reviewer prompt', () => {
    assert.match(reviewer, /examples\.md/i);
  });
});

describe('grade-loop packet format', () => {
  it('requires an acceptance checklist in the packet', () => {
    assert.match(skill, /An \*\*acceptance checklist\*\*/i);
    assert.match(skill, /acceptance checklist.*required in the packet/i);
  });

  it('requires severity tags', () => {
    assert.match(skill, /severity tags/i);
    assert.match(skill, /\[BLOCKING\] or \[ADVISORY\]/i);
  });
});

describe('grade-loop strictness modes', () => {
  it('defines three modes in rules.md', () => {
    assert.match(rules, /strictness:<lenient\|balanced\|adversarial>/i);
    assert.match(rules, /\| lenient    \|/i);
    assert.match(rules, /\| balanced   \|/i);
    assert.match(rules, /\| adversarial \|/i);
  });

  it('maps each mode to its pass threshold and MUST-FIX cap', () => {
    assert.match(rules, /\|\s*lenient\s*\|.*\|\s*80\s*\|\s*2\s*\|/i);
    assert.match(rules, /\|\s*balanced\s*\|.*\|\s*85\s*\|\s*3\s*\|/i);
    assert.match(rules, /\|\s*adversarial\s*\|.*\|\s*90\s*\|\s*5\s*\|/i);
  });

  it('requires the strictness mode in the packet from round 1', () => {
    assert.match(skill, /strictness:<lenient\|balanced\|adversarial>/i);
    assert.match(skill, /The packet must include all of the following/i);
  });

  it('defaults the strictness mode to balanced when not specified', () => {
    assert.match(skill, /If the user did not specify a mode.*use `balanced`/i);
    assert.match(rules, /`balanced` is the default/i);
  });

  it('reads thresholds and caps from rules.md instead of hard-coded defaults', () => {
    assert.match(skill, /Read `plugins\/rigor\/rules\.md`/i);
    assert.match(skill, /do not assume the old defaults of 85 and 3/i);
  });

  it('locks the strictness mode after the first round', () => {
    assert.match(skill, /Once chosen for this deliverable.*do not change the mode between rounds/i);
  });
});
