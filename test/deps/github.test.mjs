import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { GitHubError, canWrite, createGitHub, defaultRunner } from '../../plugins/deps/scripts/lib/io/github.mjs';
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

const repo = { owner: 'acme', name: 'widgets' };
const failed = { code: 1, stdout: '', stderr: 'boom' };

describe('defaultRunner', () => {
  it('returns code 127 when gh is not on PATH', async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), 'no-gh-'));
    const originalPath = process.env.PATH;
    process.env.PATH = emptyDir;
    try {
      const result = await defaultRunner(['auth', 'status']);
      assert.equal(result.code, 127);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, /not found/);
    } finally {
      process.env.PATH = originalPath;
      await rm(emptyDir, { recursive: true, force: true });
    }
  });
});

describe('listIssueComments', () => {
  it('parses one JSON object per line and ignores blank lines', async () => {
    const lines = [
      JSON.stringify({ id: 1, login: 'a', body: 'one' }),
      JSON.stringify({ id: 2, login: null, body: 'two' }),
    ];
    const { run } = scriptedRunner([ok(`${lines.join('\n')}\n\n`)]);
    assert.deepEqual(await createGitHub({ run }).listIssueComments(repo, 5), [
      { id: 1, login: 'a', body: 'one' },
      { id: 2, login: null, body: 'two' },
    ]);
  });

  it('returns an empty list for empty output', async () => {
    const { run } = scriptedRunner([ok('')]);
    assert.deepEqual(await createGitHub({ run }).listIssueComments(repo, 5), []);
  });

  it('throws a gh error on a non-zero exit', async () => {
    const { run } = scriptedRunner([failed]);
    await assert.rejects(createGitHub({ run }).listIssueComments(repo, 5), (error) => {
      assert.ok(error instanceof GitHubError);
      assert.equal(error.kind, 'gh');
      assert.match(error.message, /boom/);
      return true;
    });
  });
});

describe('viewerLogin', () => {
  it('returns the trimmed login', async () => {
    const { run } = scriptedRunner([ok('octocat\n')]);
    assert.equal(await createGitHub({ run }).viewerLogin(), 'octocat');
  });

  it('throws a gh error on a non-zero exit', async () => {
    const { run } = scriptedRunner([failed]);
    await assert.rejects(createGitHub({ run }).viewerLogin(), (error) => error instanceof GitHubError && error.kind === 'gh');
  });
});

describe('graphql errors', () => {
  it('throws a gh error when errors arrive without data', async () => {
    const { run } = scriptedRunner([ok({ errors: [{ message: 'bad field' }, { message: 'rate limited' }] })]);
    await assert.rejects(createGitHub({ run }).fetchSnapshot(repo, 1), (error) => {
      assert.ok(error instanceof GitHubError);
      assert.equal(error.kind, 'gh');
      assert.match(error.message, /bad field; rate limited/);
      return true;
    });
  });
});
