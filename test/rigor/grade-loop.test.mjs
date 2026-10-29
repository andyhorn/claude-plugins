import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const skill = readFileSync(
  new URL('../../plugins/rigor/skills/grade-loop/SKILL.md', import.meta.url),
  'utf8',
);
const reviewer = readFileSync(
  new URL('../../plugins/rigor/agents/work-reviewer.md', import.meta.url),
  'utf8',
);

describe('work-reviewer agent format', () => {
  it('tags every deduction as [BLOCKING] or [ADVISORY]', () => {
    assert.match(reviewer, /^\s*- \[BLOCKING\]/m);
    assert.match(reviewer, /^\s*- \[ADVISORY\]/m);
  });

  it('cap MUST-FIX at the 3 highest-impact [BLOCKING] deductions', () => {
    assert.match(reviewer, /MUST-FIX.*at most 3/i);
    assert.match(reviewer, /3 highest-impact \[BLOCKING\] deductions/i);
    assert.match(reviewer, /MUST-FIX.*never contains.*\[ADVISORY\]/i);
  });

  it('lets only [BLOCKING] deductions prevent a pass', () => {
    assert.match(reviewer, /Only \[BLOCKING\] deductions can prevent a pass/i);
    assert.match(reviewer, /Any \[BLOCKING\] deduction: the score is at most 84/i);
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
  it('passes at 85 or more with no [BLOCKING] deductions', () => {
    assert.match(skill, /score 85 or more.*no \[BLOCKING\] deductions remain.*MUST-FIX list is empty/i);
  });

  it('does not anchor the pass on a 90 threshold', () => {
    assert.doesNotMatch(skill, /score 90 or more with an empty MUST-FIX/);
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
