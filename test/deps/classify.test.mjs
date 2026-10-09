import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  authorFact,
  baseFact,
  BUCKETS,
  bumpsFact,
  bumpsOf,
  ciFact,
  classify,
  draftFact,
  headFact,
  mergeabilityFact,
  provenanceFact,
  securityFact,
} from '../../plugins/deps/scripts/lib/core/classify.mjs';
import { toSnapshot } from '../../plugins/deps/scripts/lib/core/snapshot.mjs';
import { applySet, loadFixture, loadRaw } from './helpers.mjs';

const fixture = loadFixture('scenarios.json');

function routine(set = {}) {
  const base = applySet(toSnapshot(loadRaw(fixture.base.raw)), fixture.base.set);
  return applySet(base, set);
}

function withChecks(items) {
  return routine({ 'checks.items': items, 'checks.totalCount': items.length });
}

function run(name, status, conclusion = null) {
  return { kind: 'CheckRun', name, status, conclusion };
}

function context(name, state) {
  return { kind: 'StatusContext', name, status: null, conclusion: state };
}

function updatedDependencies(...entries) {
  const lines = entries.map(([name, version, updateType]) => {
    const type = updateType ? `\n  update-type: version-update:semver-${updateType}` : '';
    return `- dependency-name: ${name}\n  dependency-version: ${version}\n  dependency-type: direct:production${type}`;
  });
  return `chore: bump\n\n---\nupdated-dependencies:\n${lines.join('\n')}\n...\n`;
}

describe('BUCKETS', () => {
  it('lists the buckets in precedence order', () => {
    assert.deepEqual([...BUCKETS], ['attention', 'waiting', 'blocked', 'needs-analysis', 'routine']);
  });
});

describe('real captures, unmodified', () => {
  it('puts the supabase major bump in needs-analysis even though its merge state is BLOCKED', () => {
    const result = classify(toSnapshot(loadRaw('supabase-storage-1495.json')));
    assert.equal(result.bucket, 'needs-analysis');
    assert.deepEqual(result.reasons, ['bumps']);
    assert.equal(result.analyze, true);
    assert.equal(result.sha, '5f9c17b911d426b40993997eb621ff8662989f19');
    assert.equal(result.number, 1495);
    assert.equal(result.facts.find((fact) => fact.fact === 'mergeability').status, 'info');
  });

  it('puts the rocm PR in waiting because only 12 of 156 checks were fetched', () => {
    const result = classify(toSnapshot(loadRaw('rocm-libraries-13313.json')));
    assert.equal(result.bucket, 'waiting');
    assert.deepEqual(result.reasons, ['ci']);
    assert.equal(result.suggestedAction, 'Re-run later');
    assert.equal(result.analyze, false);
    const ci = result.facts.find((fact) => fact.fact === 'ci');
    assert.deepEqual(ci, { fact: 'ci', status: 'pending', evidence: 'only 12 of 156 checks fetched' });
  });

  it('puts the Renovate PR in attention and names both author and provenance', () => {
    const result = classify(toSnapshot(loadRaw('renovate-event-store-1038.json')));
    assert.equal(result.bucket, 'attention');
    assert.deepEqual(result.reasons, ['author', 'provenance']);
    assert.equal(result.suggestedAction, 'Not a Dependabot PR; review it manually');
    assert.equal(result.analyze, false);
  });
});

describe('classify result shape', () => {
  it('returns the documented fields with facts in order', () => {
    const result = classify(routine());
    assert.deepEqual(Object.keys(result), [
      'number',
      'title',
      'url',
      'sha',
      'bucket',
      'reasons',
      'suggestedAction',
      'analyze',
      'security',
      'bumps',
      'facts',
    ]);
    assert.deepEqual(result.bumps, bumpsOf(routine()));
    assert.deepEqual(result.facts.map((fact) => fact.fact), [
      'author', 'provenance', 'draft', 'base', 'head', 'bumps', 'ci', 'mergeability', 'security',
    ]);
    for (const fact of result.facts) {
      assert.equal(typeof fact.evidence, 'string');
      assert.ok(['ok', 'fail', 'pending', 'none', 'info'].includes(fact.status));
    }
  });

  it('routes a clean patch bump to routine with the merge-review action', () => {
    const result = classify(routine());
    assert.equal(result.bucket, 'routine');
    assert.deepEqual(result.reasons, []);
    assert.equal(result.suggestedAction, 'Review the diff and merge');
    assert.equal(result.analyze, false);
    assert.equal(result.security, false);
  });
});

describe('bucket actions, reasons, and analyze', () => {
  it('attention: author comes first, then provenance, draft, base', () => {
    const notBot = routine({ 'pr.author.login': 'someone', 'pr.isDraft': true });
    assert.equal(classify(notBot).suggestedAction, 'Not a Dependabot PR; review it manually');
    assert.deepEqual(classify(notBot).reasons, ['author', 'draft']);

    const draftAndBase = routine({ 'pr.isDraft': true, 'pr.baseRefName': 'dev' });
    assert.equal(classify(draftAndBase).suggestedAction, 'Draft PR; review once it is marked ready');

    const baseAndProvenance = routine({ 'pr.baseRefName': 'dev', 'pr.isCrossRepository': true });
    const result = classify(baseAndProvenance);
    assert.equal(result.suggestedAction, 'Inspect the non-bot commits before trusting this PR');
    assert.deepEqual(result.reasons, ['provenance', 'base']);

    const baseOnly = classify(routine({ 'pr.baseRefName': 'dev' }));
    assert.equal(baseOnly.suggestedAction, 'Targets dev, not the default branch; confirm this is intended');

    const provenanceOnly = classify(routine({ 'commits.items.0.signature.valid': false }));
    assert.equal(provenanceOnly.suggestedAction, 'Inspect the non-bot commits before trusting this PR');
    assert.equal(provenanceOnly.analyze, false);
  });

  it('waiting: head moved, behind, and generic', () => {
    const moved = classify(routine({ 'pr.headRefOid': 'f'.repeat(40) }));
    assert.equal(moved.bucket, 'waiting');
    assert.equal(moved.suggestedAction, 'Head moved during collection; re-run later');
    assert.deepEqual(moved.reasons, ['head']);

    const behind = classify(routine({ 'pr.mergeStateStatus': 'BEHIND' }));
    assert.equal(behind.suggestedAction, 'Dependabot will rebase; re-run later');
    assert.deepEqual(behind.reasons, ['mergeability']);

    const running = classify(withChecks([run('t', 'IN_PROGRESS')]));
    assert.equal(running.suggestedAction, 'Re-run later');
    assert.equal(running.analyze, false);

    const several = classify(routine({
      'pr.headRefOid': 'f'.repeat(40),
      'pr.mergeable': 'UNKNOWN',
      'checks.totalCount': 99,
    }));
    assert.deepEqual(several.reasons, ['head', 'ci', 'mergeability']);
  });

  it('blocked: conflicts suggest a rebase and never analyze', () => {
    const result = classify(routine({ 'pr.mergeable': 'CONFLICTING', 'pr.mergeStateStatus': 'DIRTY' }));
    assert.equal(result.bucket, 'blocked');
    assert.equal(result.suggestedAction, 'Comment "@dependabot rebase" on the PR');
    assert.deepEqual(result.reasons, ['mergeability']);
    assert.equal(result.analyze, false);
  });

  it('blocked: failing CI is analyzed', () => {
    const result = classify(withChecks([run('t', 'COMPLETED', 'FAILURE')]));
    assert.equal(result.bucket, 'blocked');
    assert.equal(result.suggestedAction, 'Investigate the failing CI');
    assert.deepEqual(result.reasons, ['ci']);
    assert.equal(result.analyze, true);
  });

  it('blocked: no CI is not analyzed', () => {
    const result = classify(withChecks([]));
    assert.equal(result.bucket, 'blocked');
    assert.equal(result.suggestedAction, 'No passing CI; verify the change manually or add CI');
    assert.equal(result.analyze, false);
  });

  it('blocked: conflicts take the action even when CI also fails, and CI failure still triggers analysis', () => {
    const result = classify(routine({
      'pr.mergeable': 'CONFLICTING',
      'pr.mergeStateStatus': 'DIRTY',
      'checks.items': [run('t', 'COMPLETED', 'FAILURE')],
      'checks.totalCount': 1,
    }));
    assert.equal(result.suggestedAction, 'Comment "@dependabot rebase" on the PR');
    assert.deepEqual(result.reasons, ['ci', 'mergeability']);
    assert.equal(result.analyze, true);
  });

  it('needs-analysis: always analyzed', () => {
    const result = classify(routine({
      'commits.items.0.message': updatedDependencies(['a', '2.0.0', 'major']),
    }));
    assert.equal(result.bucket, 'needs-analysis');
    assert.equal(result.suggestedAction, 'Read the impact analysis before deciding');
    assert.equal(result.analyze, true);
  });

  it('flags security without changing the bucket', () => {
    const result = classify(routine({ 'pr.labels': ['security'] }));
    assert.equal(result.bucket, 'routine');
    assert.equal(result.security, true);
  });
});

describe('authorFact', () => {
  it('requires a Bot typed author with login dependabot', () => {
    assert.equal(authorFact(routine()).status, 'ok');
    assert.equal(authorFact(routine({ 'pr.author.type': 'User' })).status, 'fail');
    assert.equal(authorFact(routine({ 'pr.author.login': 'dependabot[bot]' })).status, 'fail');
    assert.equal(
      authorFact(routine({ 'pr.author.type': 'User', 'pr.author.login': 'dependabot' })).evidence,
      'not a Dependabot PR (author User dependabot)',
    );
  });
});

describe('provenanceFact', () => {
  it('lists every offending commit and every reason', () => {
    const snapshot = routine({
      'commits.totalCount': 3,
      'commits.items.0.signature.valid': false,
      'commits.items.1': {
        oid: '1111111aaaa',
        message: 'm',
        author: { name: 'x', email: 'x@example.com', login: 'x' },
        signature: { valid: true, signedByGitHub: false, signer: 'x' },
      },
      'commits.items.2': {
        oid: '2222222bbbb',
        message: 'm',
        author: { name: 'dependabot[bot]', email: '49699333+dependabot[bot]@users.noreply.github.com', login: 'dependabot[bot]' },
        signature: { valid: true, signedByGitHub: true, signer: 'web-flow' },
      },
    });
    assert.deepEqual(provenanceFact(snapshot), {
      fact: 'provenance',
      status: 'fail',
      evidence: '5f9c17b: unsigned; 1111111: not signed by GitHub, signer x, author email x@example.com, author login x',
    });
  });

  it('combines repository and fetch problems with commit problems', () => {
    const snapshot = routine({
      'pr.isCrossRepository': true,
      'commits.totalCount': 5,
      'commits.items.0.signature.signer': 'mallory',
    });
    assert.equal(
      provenanceFact(snapshot).evidence,
      'cross-repository; only 1 of 5 commits fetched; 5f9c17b: signer mallory',
    );
  });

  it('fails a missing signature', () => {
    const snapshot = routine({ 'commits.items.0.signature': { valid: false, signedByGitHub: false, signer: null } });
    assert.equal(provenanceFact(snapshot).evidence, '5f9c17b: unsigned');
  });

  it('pluralizes the ok evidence', () => {
    assert.match(provenanceFact(routine()).evidence, /^1 commit authored/);
  });
});

describe('draftFact and baseFact', () => {
  it('reports drafts', () => {
    assert.deepEqual(draftFact(routine({ 'pr.isDraft': true })), { fact: 'draft', status: 'fail', evidence: 'draft PR' });
    assert.equal(draftFact(routine()).status, 'ok');
  });

  it('names both branches when the base differs', () => {
    assert.equal(baseFact(routine({ 'pr.baseRefName': 'next' })).evidence, 'targets next, default branch is master');
    assert.equal(baseFact(routine()).status, 'ok');
  });
});

describe('headFact', () => {
  it('is ok when commits and checks match the head, or when there is no checks oid', () => {
    assert.equal(headFact(routine()).status, 'ok');
    assert.equal(headFact(routine({ 'checks.oid': null })).status, 'ok');
  });

  it('is pending when there are no commits', () => {
    const snapshot = routine({ 'commits.items': [], 'commits.totalCount': 0 });
    assert.equal(headFact(snapshot).evidence, 'head moved (PR head 5f9c17b, last commit none, checks 5f9c17b)');
  });
});

describe('bumpsOf and bumpsFact', () => {
  it('returns structured updates sorted by name with from-versions', () => {
    const bumps = bumpsOf(toSnapshot(loadRaw('rocm-libraries-13313.json')));
    assert.equal(bumps.length, 15);
    assert.deepEqual(bumps.map((bump) => bump.name), [...bumps.map((bump) => bump.name)].sort());
    assert.deepEqual(bumps.find((bump) => bump.name === 'actions/checkout'), {
      name: 'actions/checkout',
      from: '4.4.0',
      to: '7.0.1',
      dependencyType: 'direct:production',
      updateType: 'major',
      effective: 'major',
      group: 'github-actions',
    });
    const pinned = bumps.find((bump) => bump.name === 'ROCm/TheRock/.github/workflows/setup_multi_arch.yml');
    assert.equal(pinned.updateType, null);
    assert.equal(pinned.effective, 'unknown');
    assert.equal(pinned.from, '05add1921fd03b0649f054ec2a7c54d162c0cd99');
    assert.equal(pinned.to, '2fb7b81cf159a2d62ac7ef91960446450db6ed72');
  });

  it('shows ? when the from-version is unknown', () => {
    const snapshot = routine({
      'pr.body': '',
      'commits.items.0.message': updatedDependencies(['zeta', '1.0.1', 'patch']),
    });
    assert.equal(bumpsOf(snapshot)[0].from, null);
    assert.equal(bumpsFact(snapshot).evidence, 'zeta ?→1.0.1 (direct:production, patch → patch)');
  });

  it('prefers the PR body over the commit message for from-versions', () => {
    const snapshot = routine({
      'pr.body': 'Bumps [zeta](u) from 1.0.0 to 1.0.1.',
      'commits.items.0.message': `Bumps [zeta](u) from 0.0.9 to 1.0.1.\n\n${updatedDependencies(['zeta', '1.0.1', 'patch'])}`,
    });
    assert.equal(bumpsOf(snapshot)[0].from, '1.0.0');
  });

  it('reads only the first commit, even with commits on top', () => {
    const snapshot = routine({
      'commits.totalCount': 2,
      'commits.items.1': {
        oid: 'e'.repeat(40),
        message: updatedDependencies(['sneaky', '9.0.0', 'major']),
        author: { name: 'h', email: 'h@example.com', login: 'h' },
        signature: { valid: true, signedByGitHub: true, signer: 'web-flow' },
      },
    });
    assert.deepEqual(bumpsOf(snapshot).map((bump) => bump.name), ['fast-json-stringify']);
  });

  it('returns an empty list when the metadata is missing', () => {
    assert.deepEqual(bumpsOf(routine({ 'commits.items.0.message': 'nothing' })), []);
    assert.deepEqual(bumpsOf(routine({ 'commits.items': [], 'commits.totalCount': 0 })), []);
  });

  it('sorts same-named updates by version', () => {
    const snapshot = routine({
      'commits.items.0.message': updatedDependencies(['dup', '2.0.0', 'patch'], ['dup', '1.0.0', 'patch']),
    });
    assert.deepEqual(bumpsOf(snapshot).map((bump) => bump.to), ['1.0.0', '2.0.0']);
  });

  it('is ok only when every update is effectively patch or minor', () => {
    const mixed = routine({
      'commits.items.0.message': updatedDependencies(['a', '1.0.1', 'patch'], ['b', '1.2.0', 'minor']),
    });
    assert.equal(bumpsFact(mixed).status, 'ok');
    const oneMajor = routine({
      'commits.items.0.message': updatedDependencies(['a', '1.0.1', 'patch'], ['b', '2.0.0', 'major']),
    });
    assert.equal(bumpsFact(oneMajor).status, 'info');
    const oneUnknown = routine({
      'commits.items.0.message': updatedDependencies(['a', '1.0.1', 'patch'], ['b', 'abc123', null]),
    });
    assert.equal(bumpsFact(oneUnknown).status, 'info');
  });
});

describe('ciFact normalization', () => {
  it('treats every non-completed CheckRun status as running', () => {
    for (const status of ['QUEUED', 'IN_PROGRESS', 'WAITING', 'PENDING', 'REQUESTED', 'SOMETHING_NEW', null]) {
      assert.equal(ciFact(withChecks([run('x', status)])).status, 'pending', String(status));
    }
  });

  it('treats completed conclusions as success, neutral, or failing', () => {
    assert.equal(ciFact(withChecks([run('x', 'COMPLETED', 'SUCCESS')])).status, 'ok');
    assert.equal(ciFact(withChecks([run('x', 'COMPLETED', 'SKIPPED')])).status, 'none');
    assert.equal(ciFact(withChecks([run('x', 'COMPLETED', 'NEUTRAL')])).status, 'none');
    for (const conclusion of ['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STALE', 'STARTUP_FAILURE', 'SOMETHING_NEW', null]) {
      assert.equal(ciFact(withChecks([run('x', 'COMPLETED', conclusion)])).status, 'fail', String(conclusion));
    }
  });

  it('treats StatusContext states as running, success, or failing', () => {
    assert.equal(ciFact(withChecks([context('x', 'PENDING')])).status, 'pending');
    assert.equal(ciFact(withChecks([context('x', 'EXPECTED')])).status, 'pending');
    assert.equal(ciFact(withChecks([context('x', 'SUCCESS')])).status, 'ok');
    assert.equal(ciFact(withChecks([context('x', 'FAILURE')])).status, 'fail');
    assert.equal(ciFact(withChecks([context('x', 'ERROR')])).status, 'fail');
    assert.equal(ciFact(withChecks([context('x', 'SOMETHING_NEW')])).status, 'fail');
  });

  it('counts skipped alongside success as ok', () => {
    const fact = ciFact(withChecks([run('a', 'COMPLETED', 'SUCCESS'), run('b', 'COMPLETED', 'SKIPPED')]));
    assert.deepEqual(fact, { fact: 'ci', status: 'ok', evidence: '1 passed, 1 skipped/neutral' });
  });

  it('sorts names so the evidence does not depend on check order', () => {
    const a = ciFact(withChecks([run('b', 'IN_PROGRESS'), run('a', 'QUEUED')]));
    const b = ciFact(withChecks([run('a', 'QUEUED'), run('b', 'IN_PROGRESS')]));
    assert.equal(a.evidence, 'running: a, b');
    assert.deepEqual(a, b);
  });

  it('checks completeness before anything else', () => {
    const snapshot = routine({
      'checks.items': [run('x', 'COMPLETED', 'FAILURE')],
      'checks.totalCount': 2,
    });
    assert.equal(ciFact(snapshot).evidence, 'only 1 of 2 checks fetched');
  });
});

describe('mergeabilityFact', () => {
  function merge(mergeable, mergeStateStatus) {
    return mergeabilityFact(routine({ 'pr.mergeable': mergeable, 'pr.mergeStateStatus': mergeStateStatus }));
  }

  it('fails on CONFLICTING or DIRTY', () => {
    assert.equal(merge('CONFLICTING', 'DIRTY').status, 'fail');
    assert.equal(merge('MERGEABLE', 'DIRTY').status, 'fail');
    assert.equal(merge('CONFLICTING', 'CLEAN').status, 'fail');
  });

  it('is pending on UNKNOWN or BEHIND', () => {
    assert.equal(merge('UNKNOWN', 'CLEAN').status, 'pending');
    assert.equal(merge('MERGEABLE', 'UNKNOWN').status, 'pending');
    assert.equal(merge('MERGEABLE', 'BEHIND').status, 'pending');
  });

  it('reports BLOCKED, UNSTABLE, and HAS_HOOKS as info', () => {
    for (const state of ['BLOCKED', 'UNSTABLE', 'HAS_HOOKS']) {
      const fact = merge('MERGEABLE', state);
      assert.equal(fact.status, 'info');
      assert.ok(fact.evidence.startsWith(`${state}:`));
    }
  });

  it('is ok on CLEAN and info with raw values on anything else', () => {
    assert.equal(merge('MERGEABLE', 'CLEAN').status, 'ok');
    assert.deepEqual(merge('MERGEABLE', 'DRAFT'), {
      fact: 'mergeability',
      status: 'info',
      evidence: 'mergeable MERGEABLE, merge state DRAFT',
    });
  });
});

describe('securityFact', () => {
  it('ignores plain body mentions and matches the section case-insensitively', () => {
    assert.equal(securityFact(routine({ 'pr.body': 'managing-security-vulnerabilities' })).status, 'none');
    assert.equal(securityFact(routine({ 'pr.body': '<SUMMARY>vulnerabilities fixed</SUMMARY>' })).status, 'info');
    assert.equal(securityFact(routine({ 'pr.labels': ['SECURITY'] })).status, 'info');
    assert.equal(securityFact(routine({ 'pr.labels': ['security-review'] })).status, 'none');
  });
});
