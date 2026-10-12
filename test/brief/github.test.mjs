import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { createGitHub, defaultRunner } from '../../plugins/brief/scripts/lib/io/github.mjs';

describe('createGitHub', () => {
  function client(result) {
    const calls = [];
    const gh = createGitHub({
      run: async (args, opts) => {
        calls.push({ args, opts });
        return result;
      },
    });
    return { gh, calls };
  }

  it('runs exactly the expected gh command in the given directory', async () => {
    const { gh, calls } = client({ code: 0, stdout: '[]', stderr: '' });
    await gh.listPullRequests('/repo');
    assert.deepEqual(calls, [
      {
        args: ['pr', 'list', '--state', 'all', '--limit', '200', '--json', 'number,state,mergedAt,headRefName,isCrossRepository,reviewDecision,statusCheckRollup'],
        opts: { cwd: '/repo' },
      },
    ]);
  });

  it('maps pull requests through the core mapper', async () => {
    const raw = [
      { number: 1, state: 'OPEN', mergedAt: null, headRefName: 'a', isCrossRepository: true, reviewDecision: '', statusCheckRollup: [] },
      { number: 2, state: 'MERGED', mergedAt: '2026-10-01T00:00:00Z', headRefName: 'b', isCrossRepository: false, reviewDecision: 'APPROVED', statusCheckRollup: [{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' }] },
    ];
    const { gh } = client({ code: 0, stdout: JSON.stringify(raw), stderr: '' });
    assert.deepEqual(await gh.listPullRequests('/repo'), [
      { number: 1, state: 'OPEN', mergedAt: null, headRefName: 'a', isCrossRepository: true, reviewDecision: null, ci: null },
      { number: 2, state: 'MERGED', mergedAt: '2026-10-01T00:00:00Z', headRefName: 'b', isCrossRepository: false, reviewDecision: 'APPROVED', ci: 'success' },
    ]);
  });

  it('explains a missing gh CLI', async () => {
    const { gh } = client({ code: 127, stdout: '', stderr: 'gh: command not found' });
    await assert.rejects(gh.listPullRequests('/repo'), /gh CLI not found; install it from https:\/\/cli\.github\.com/);
  });

  it('throws the stderr of a failed gh call', async () => {
    const { gh } = client({ code: 1, stdout: '', stderr: 'not logged in\n' });
    await assert.rejects(gh.listPullRequests('/repo'), /not logged in/);
  });

  it('throws on invalid JSON', async () => {
    const { gh } = client({ code: 0, stdout: 'nope', stderr: '' });
    await assert.rejects(gh.listPullRequests('/repo'), /invalid JSON/);
  });

  it('throws when the JSON is not a list', async () => {
    for (const stdout of ['{}', 'null', '"x"', '3']) {
      const { gh } = client({ code: 0, stdout, stderr: '' });
      await assert.rejects(gh.listPullRequests('/repo'), /invalid JSON/);
    }
  });

  it('falls back to the exit code when gh prints nothing', async () => {
    const { gh } = client({ code: 4, stdout: '', stderr: '' });
    await assert.rejects(gh.listPullRequests('/repo'), /exit code 4/);
  });
});

describe('defaultRunner', () => {
  const roots = [];

  function fakeGhDir(script) {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'brief-gh-')));
    roots.push(dir);
    writeFileSync(join(dir, 'gh'), `#!/bin/sh\n${script}\n`, { mode: 0o755 });
    return dir;
  }

  async function withPath(path, task) {
    const original = process.env.PATH;
    process.env.PATH = path;
    try {
      return await task();
    } finally {
      process.env.PATH = original;
    }
  }

  after(() => {
    for (const dir of roots) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('resolves 127 when gh is not installed', async () => {
    const result = await withPath('/nonexistent', () => defaultRunner(['--version'], { cwd: process.cwd() }));
    assert.equal(result.code, 127);
  });

  it('returns the output of a successful call', async () => {
    const dir = fakeGhDir('echo hello');
    const result = await withPath(dir, () => defaultRunner(['x']));
    assert.deepEqual(result, { code: 0, stdout: 'hello\n', stderr: '' });
  });

  it('kills a call that outlives the timeout and reports it as a failure', async () => {
    const dir = fakeGhDir('exec /bin/sleep 5');
    const result = await withPath(dir, () => defaultRunner(['x'], { timeoutMs: 100 }));
    assert.equal(result.code, 1);
    assert.match(result.stderr, /timed out/);
  });

  it('surfaces a timeout as an error from listPullRequests', async () => {
    const dir = fakeGhDir('exec /bin/sleep 5');
    const gh = createGitHub({ run: (args, opts) => defaultRunner(args, { ...opts, timeoutMs: 100 }) });
    await withPath(dir, () => assert.rejects(gh.listPullRequests(process.cwd()), /timed out/));
  });
});
