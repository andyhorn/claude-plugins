import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { canWrite, createGitHub } from '../../plugins/deps/scripts/lib/io/github.mjs';
import { loadRaw } from './helpers.mjs';

function scriptedRunner(responses) {
  const calls = [];
  const queue = [...responses];
  const run = async (args, opts) => {
    calls.push({ args, input: opts?.input });
    const next = queue.shift();
    return typeof next === 'function' ? next(args) : next;
  };
  return { calls, run };
}

const ok = (value) => ({ code: 0, stdout: typeof value === 'string' ? value : JSON.stringify(value), stderr: '' });
const repoView = (extra = {}) => ok({
  nameWithOwner: 'acme/widgets',
  isArchived: false,
  defaultBranchRef: { name: 'main' },
  viewerPermission: 'WRITE',
  ...extra,
});

async function kindOf(responses) {
  const { run } = scriptedRunner(responses);
  try {
    await createGitHub({ run }).preflight();
  } catch (error) {
    return error.kind;
  }
  return null;
}

describe('preflight', () => {
  it('returns the repository details', async () => {
    const { run } = scriptedRunner([ok(''), repoView()]);
    assert.deepEqual(await createGitHub({ run }).preflight(), {
      nameWithOwner: 'acme/widgets',
      owner: 'acme',
      name: 'widgets',
      defaultBranch: 'main',
      viewerPermission: 'WRITE',
    });
  });

  it('reports auth when gh is not logged in', async () => {
    assert.equal(await kindOf([{ code: 1, stdout: '', stderr: 'not logged in' }]), 'auth');
  });

  it('reports auth when gh is missing', async () => {
    assert.equal(await kindOf([{ code: 127, stdout: '', stderr: '' }]), 'auth');
  });

  it('reports repo when the repository cannot be resolved', async () => {
    assert.equal(await kindOf([ok(''), { code: 1, stdout: '', stderr: 'no default' }]), 'repo');
  });

  it('reports archived repositories', async () => {
    assert.equal(await kindOf([ok(''), repoView({ isArchived: true })]), 'archived');
  });
});

describe('listBotPrNumbers', () => {
  it('merges both apps, dedupes, and sorts ascending', async () => {
    const { calls, run } = scriptedRunner([ok([{ number: 9 }, { number: 3 }]), ok([{ number: 3 }, { number: 1 }])]);
    assert.deepEqual(await createGitHub({ run }).listBotPrNumbers(), [1, 3, 9]);
    assert.ok(calls[0].args.includes('dependabot'));
    assert.ok(calls[1].args.includes('renovate'));
  });
});

describe('fetchSnapshot', () => {
  it('merges check context pages', async () => {
    const first = structuredClone(loadRaw('supabase-storage-1495.json'));
    const contexts = first.repository.pullRequest.headCommit.nodes[0].commit.statusCheckRollup.contexts;
    const [head, ...rest] = contexts.nodes;
    contexts.nodes = [head];
    contexts.pageInfo = { hasNextPage: true, endCursor: 'CUR1' };
    const page = {
      repository: {
        pullRequest: {
          headCommit: {
            nodes: [{ commit: { statusCheckRollup: { contexts: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: rest } } } }],
          },
        },
      },
    };
    const { calls, run } = scriptedRunner([ok({ data: first }), ok({ data: page })]);
    const snapshot = await createGitHub({ run }).fetchSnapshot({ owner: 'supabase', name: 'storage' }, 1495);
    assert.equal(calls.length, 2);
    assert.ok(calls[0].args.includes('number=1495'));
    assert.ok(calls[1].args.includes('cursor=CUR1'));
    assert.equal(snapshot.checks.items.length, 34);
    assert.equal(snapshot.checks.items[0].name, 'Local / direct / s3 / pg / single');
    assert.equal(snapshot.checks.items.at(-1).name, 'coverage/coveralls/patch');
  });
});

describe('canWrite', () => {
  it('allows write, maintain, and admin only', () => {
    assert.equal(canWrite('WRITE'), true);
    assert.equal(canWrite('MAINTAIN'), true);
    assert.equal(canWrite('ADMIN'), true);
    assert.equal(canWrite('READ'), false);
    assert.equal(canWrite('TRIAGE'), false);
    assert.equal(canWrite(undefined), false);
  });
});
