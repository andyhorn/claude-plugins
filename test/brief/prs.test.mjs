import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { pickPr, summarizeChecks, toPullRequest } from '../../plugins/brief/scripts/lib/core/prs.mjs';

const node = (type, fields) => ({ __typename: type, ...fields });
const checkRun = (status, conclusion) => node('CheckRun', { status, conclusion });
const context = (state) => node('StatusContext', { state });

describe('summarizeChecks', () => {
  it('is null without checks', () => {
    assert.equal(summarizeChecks([]), null);
    assert.equal(summarizeChecks(null), null);
    assert.equal(summarizeChecks(undefined), null);
  });

  it('is success when everything completed fine', () => {
    assert.equal(summarizeChecks([checkRun('COMPLETED', 'SUCCESS'), checkRun('COMPLETED', 'SKIPPED'), context('SUCCESS')]), 'success');
  });

  for (const conclusion of ['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE']) {
    it(`is failure for a ${conclusion} check run`, () => {
      assert.equal(summarizeChecks([checkRun('COMPLETED', 'SUCCESS'), checkRun('COMPLETED', conclusion)]), 'failure');
    });
  }

  it('is failure for a failed status context', () => {
    assert.equal(summarizeChecks([context('FAILURE')]), 'failure');
    assert.equal(summarizeChecks([context('ERROR')]), 'failure');
  });

  it('is pending for unfinished runs and contexts', () => {
    assert.equal(summarizeChecks([checkRun('IN_PROGRESS', null)]), 'pending');
    assert.equal(summarizeChecks([checkRun('QUEUED', null)]), 'pending');
    assert.equal(summarizeChecks([context('PENDING')]), 'pending');
    assert.equal(summarizeChecks([context('EXPECTED')]), 'pending');
  });

  it('prefers failure over pending', () => {
    assert.equal(summarizeChecks([checkRun('IN_PROGRESS', null), checkRun('COMPLETED', 'FAILURE')]), 'failure');
  });
});

describe('toPullRequest', () => {
  it('maps gh fields and summarizes checks', () => {
    const raw = {
      number: 2,
      state: 'MERGED',
      mergedAt: '2026-10-01T00:00:00Z',
      headRefName: 'b',
      isCrossRepository: false,
      reviewDecision: 'APPROVED',
      statusCheckRollup: [checkRun('COMPLETED', 'SUCCESS')],
    };
    assert.deepEqual(toPullRequest(raw), {
      number: 2,
      state: 'MERGED',
      mergedAt: '2026-10-01T00:00:00Z',
      headRefName: 'b',
      isCrossRepository: false,
      reviewDecision: 'APPROVED',
      ci: 'success',
    });
  });

  it('normalizes absent or empty fields', () => {
    const raw = { number: 1, state: 'OPEN', headRefName: 'a', reviewDecision: '', statusCheckRollup: [] };
    assert.deepEqual(toPullRequest(raw), {
      number: 1,
      state: 'OPEN',
      mergedAt: null,
      headRefName: 'a',
      isCrossRepository: false,
      reviewDecision: null,
      ci: null,
    });
  });

  it('keeps the cross-repository flag', () => {
    assert.equal(toPullRequest({ number: 1, headRefName: 'a', isCrossRepository: true }).isCrossRepository, true);
  });
});

describe('pickPr', () => {
  it('returns null without a match', () => {
    assert.equal(pickPr([{ number: 1, state: 'OPEN', headRefName: 'other' }], 'feat/x'), null);
    assert.equal(pickPr([], 'feat/x'), null);
    assert.equal(pickPr([{ number: 1, state: 'OPEN', headRefName: 'feat/x' }], null), null);
  });

  it('prefers an open PR over a newer merged one', () => {
    const prs = [
      { number: 9, state: 'MERGED', headRefName: 'feat/x' },
      { number: 4, state: 'OPEN', headRefName: 'feat/x' },
    ];
    assert.equal(pickPr(prs, 'feat/x').number, 4);
  });

  it('takes the highest number when none is open', () => {
    const prs = [
      { number: 3, state: 'CLOSED', headRefName: 'feat/x' },
      { number: 7, state: 'MERGED', headRefName: 'feat/x' },
    ];
    assert.equal(pickPr(prs, 'feat/x').number, 7);
  });

  it('ignores pull requests from forks', () => {
    const prs = [
      { number: 9, state: 'MERGED', headRefName: 'patch-1', isCrossRepository: true },
      { number: 4, state: 'CLOSED', headRefName: 'patch-1', isCrossRepository: false },
    ];
    assert.equal(pickPr(prs, 'patch-1').number, 4);
    assert.equal(pickPr([prs[0]], 'patch-1'), null);
  });
});
