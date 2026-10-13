import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SNAPSHOT_QUERY, toSnapshot } from '../../plugins/deps/scripts/lib/core/snapshot.mjs';
import { loadRaw } from './helpers.mjs';

describe('SNAPSHOT_QUERY', () => {
  it('declares the variables and pages the check contexts', () => {
    assert.match(SNAPSHOT_QUERY, /\$owner: String!, \$name: String!, \$number: Int!/);
    assert.match(SNAPSHOT_QUERY, /pageInfo \{ hasNextPage endCursor \}/);
  });
});

describe('toSnapshot', () => {
  it('converts the supabase capture', () => {
    const snapshot = toSnapshot(loadRaw('supabase-storage-1495.json'));
    assert.equal(snapshot.viewer, 'andyhorn');
    assert.deepEqual(snapshot.repo, {
      nameWithOwner: 'supabase/storage',
      defaultBranch: 'master',
      isArchived: false,
      viewerPermission: 'READ',
    });
    assert.equal(snapshot.pr.number, 1495);
    assert.deepEqual(snapshot.pr.author, { type: 'Bot', login: 'dependabot' });
    assert.equal(snapshot.pr.mergeable, 'MERGEABLE');
    assert.equal(snapshot.pr.mergeStateStatus, 'BLOCKED');
    assert.equal(snapshot.pr.headRefOid, '5f9c17b911d426b40993997eb621ff8662989f19');
    assert.deepEqual(snapshot.pr.labels, ['dependencies', 'javascript']);
    assert.equal(snapshot.commits.totalCount, 1);
    assert.equal(snapshot.commits.items.length, 1);
    assert.deepEqual(snapshot.commits.items[0].author, {
      name: 'dependabot[bot]',
      email: '49699333+dependabot[bot]@users.noreply.github.com',
      login: 'dependabot[bot]',
    });
    assert.deepEqual(snapshot.commits.items[0].signature, {
      valid: true,
      signedByGitHub: true,
      signer: 'web-flow',
    });
    assert.match(snapshot.commits.items[0].message, /^chore\(deps\): bump fast-json-stringify/);
  });

  it('maps CheckRun and StatusContext items', () => {
    const { checks } = toSnapshot(loadRaw('supabase-storage-1495.json'));
    assert.equal(checks.oid, '5f9c17b911d426b40993997eb621ff8662989f19');
    assert.equal(checks.rollupState, 'SUCCESS');
    assert.equal(checks.totalCount, 34);
    assert.equal(checks.items.length, 34);
    assert.deepEqual(checks.items[0], {
      kind: 'CheckRun',
      name: 'Local / direct / s3 / pg / single',
      status: 'COMPLETED',
      conclusion: 'SUCCESS',
    });
    assert.deepEqual(checks.items.at(-1), {
      kind: 'StatusContext',
      name: 'coverage/coveralls/patch',
      status: null,
      conclusion: 'SUCCESS',
    });
  });

  it('keeps an incomplete check list visible through totalCount', () => {
    const { checks, pr, commits } = toSnapshot(loadRaw('rocm-libraries-13313.json'));
    assert.equal(checks.totalCount, 156);
    assert.equal(checks.items.length, 12);
    assert.equal(checks.rollupState, 'FAILURE');
    assert.equal(pr.baseRefName, 'develop');
    assert.equal(commits.items[0].oid, pr.headRefOid);
  });

  it('converts the Renovate capture', () => {
    const snapshot = toSnapshot(loadRaw('renovate-event-store-1038.json'));
    assert.deepEqual(snapshot.pr.author, { type: 'Bot', login: 'renovate' });
    assert.equal(snapshot.commits.items[0].author.login, 'renovate[bot]');
    assert.equal(snapshot.commits.items[0].signature.signer, 'web-flow');
    assert.equal(snapshot.checks.rollupState, 'PENDING');
    assert.equal(snapshot.checks.items.find((item) => item.name === 'Run lint').status, 'QUEUED');
  });

  it('handles a missing rollup, signature, author, and default branch', () => {
    const data = structuredClone(loadRaw('supabase-storage-1495.json'));
    const pr = data.repository.pullRequest;
    pr.headCommit.nodes[0].commit.statusCheckRollup = null;
    pr.commits.nodes[0].commit.signature = null;
    pr.commits.nodes[0].commit.author = null;
    pr.author = null;
    data.repository.defaultBranchRef = null;
    const snapshot = toSnapshot(data);
    assert.deepEqual(snapshot.checks, {
      oid: '5f9c17b911d426b40993997eb621ff8662989f19',
      rollupState: null,
      totalCount: 0,
      items: [],
    });
    assert.deepEqual(snapshot.commits.items[0].signature, { valid: false, signedByGitHub: false, signer: null });
    assert.deepEqual(snapshot.commits.items[0].author, { name: null, email: null, login: null });
    assert.deepEqual(snapshot.pr.author, { type: null, login: null });
    assert.equal(snapshot.repo.defaultBranch, null);
  });

  it('reports a null checks oid when there is no head commit', () => {
    const data = structuredClone(loadRaw('supabase-storage-1495.json'));
    data.repository.pullRequest.headCommit.nodes = [];
    assert.deepEqual(toSnapshot(data).checks, { oid: null, rollupState: null, totalCount: 0, items: [] });
  });

  it('throws a descriptive error when the repository is missing', () => {
    assert.throws(() => toSnapshot({ viewer: { login: 'x' }, repository: null }), /no repository/);
    assert.throws(() => toSnapshot(null), /no repository/);
  });

  it('throws a descriptive error when the pull request is missing', () => {
    const data = { viewer: { login: 'x' }, repository: { nameWithOwner: 'o/r', pullRequest: null } };
    assert.throws(() => toSnapshot(data), /no pull request in o\/r/);
  });
});
