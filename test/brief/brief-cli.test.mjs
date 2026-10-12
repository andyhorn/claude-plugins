import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';

import { createGitHub } from '../../plugins/brief/scripts/lib/io/github.mjs';
import { main } from '../../plugins/brief/scripts/brief.mjs';

const ARTIFACT = 'https://claude.ai/code/artifact/abc-123';
const NOW = new Date('2026-10-09T23:15:00.000Z');
const sha1 = (text) => createHash('sha1').update(text).digest('hex');

const roots = [];

function isolateGitEnvironment() {
  for (const name of Object.keys(process.env)) {
    if (name.startsWith('GIT_')) {
      delete process.env[name];
    }
  }
  process.env.GIT_CONFIG_GLOBAL = '/dev/null';
  process.env.GIT_CONFIG_NOSYSTEM = '1';
}

isolateGitEnvironment();

function tempDir(prefix) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `brief-${prefix}-`)));
  roots.push(dir);
  return dir;
}

after(() => {
  for (const dir of roots) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function makeRepo({ origin = null } = {}) {
  const dir = tempDir('repo');
  git(dir, 'init', '-b', 'main');
  writeFileSync(join(dir, 'a.txt'), 'a\n');
  git(dir, 'add', 'a.txt');
  git(dir, 'commit', '-m', 'init');
  if (origin) {
    git(dir, 'remote', 'add', 'origin', origin);
  }
  return dir;
}

function sink() {
  return {
    text: '',
    write(chunk) {
      this.text += chunk;
    },
  };
}

function fakeEnv(overrides = {}) {
  return { now: () => NOW, newId: () => 'a1b2c3', hostname: () => 'laptop', sha1, ...overrides };
}

function scriptedRunner(result) {
  const calls = [];
  const run = async (args, opts) => {
    calls.push({ args, opts });
    return typeof result === 'function' ? result(args, opts) : result;
  };
  return { run, calls };
}

function ghWith(result) {
  const runner = scriptedRunner(result);
  return { gh: createGitHub({ run: runner.run }), calls: runner.calls };
}

async function brief(argv, deps = {}) {
  const stdout = sink();
  const stderr = sink();
  const code = await main(argv, { env: fakeEnv(), stdout, stderr, ...deps });
  return { code, out: stdout.text, err: stderr.text, json: () => JSON.parse(stdout.text) };
}

describe('usage errors', () => {
  const cases = [
    ['no command', []],
    ['unknown command', ['nope', '--data', '/d']],
    ['missing --data', ['state']],
    ['relative --data', ['state', '--data', 'rel/dir']],
    ['unexpanded plugin data variable', ['state', '--data', '${CLAUDE_PLUGIN_DATA}']],
    ['foreign url host', ['state', '--data', '/d', '--set-url', 'https://evil.example/artifact/x', '--page-version', '1']],
    ['url with a query', ['state', '--data', '/d', '--set-url', 'https://claude.ai/artifact/x?y', '--page-version', '1']],
    ['set-url without page-version', ['state', '--data', '/d', '--set-url', ARTIFACT]],
    ['page-version without set-url', ['state', '--data', '/d', '--page-version', '2']],
    ['non-numeric page-version', ['state', '--data', '/d', '--set-url', ARTIFACT, '--page-version', 'x']],
    ['tidy without --entries', ['tidy', '--data', '/d']],
    ['foreign option', ['context', '--data', '/d', '--pr']],
    ['unknown option', ['state', '--data', '/d', '--bogus']],
  ];
  for (const [label, argv] of cases) {
    it(`exits 2 for ${label}`, async () => {
      const result = await brief(argv);
      assert.equal(result.code, 2);
      assert.match(result.err, /^brief: /);
      assert.match(result.err, /usage: brief\.mjs/);
      assert.equal(result.out, '');
    });
  }

  it('exits 6 on Node older than 22', async () => {
    const result = await brief(['state', '--data', '/d'], { nodeVersion: '20.11.0' });
    assert.equal(result.code, 6);
    assert.match(result.err, /Node 22/);
  });
});

describe('state', () => {
  it('exits 4 when nothing is saved', async () => {
    const data = tempDir('data');
    const result = await brief(['state', '--data', data]);
    assert.equal(result.code, 4);
    assert.match(result.err, /brief is not set up; run \/brief/);
  });

  it('round-trips through a created data directory', async () => {
    const data = join(tempDir('data'), 'nested', 'dir');
    const set = await brief(['state', '--data', data, '--set-url', ARTIFACT, '--page-version', '2']);
    assert.equal(set.code, 0);
    assert.deepEqual(set.json(), { url: ARTIFACT, pageVersion: 2 });
    const read = await brief(['state', '--data', data]);
    assert.equal(read.code, 0);
    assert.deepEqual(read.json(), { url: ARTIFACT, pageVersion: 2 });
    assert.deepEqual(JSON.parse(readFileSync(join(data, 'state.json'), 'utf8')), { url: ARTIFACT, pageVersion: 2 });
  });

  it('overwrites an earlier state', async () => {
    const data = tempDir('data');
    await brief(['state', '--data', data, '--set-url', ARTIFACT, '--page-version', '1']);
    await brief(['state', '--data', data, '--set-url', ARTIFACT, '--page-version', '5']);
    assert.deepEqual((await brief(['state', '--data', data])).json(), { url: ARTIFACT, pageVersion: 5 });
  });

  it('treats a corrupt or foreign state file as not set up', async () => {
    const data = tempDir('data');
    writeFileSync(join(data, 'state.json'), '{not json');
    assert.equal((await brief(['state', '--data', data])).code, 4);
    writeFileSync(join(data, 'state.json'), JSON.stringify({ url: 'https://evil.example/artifact/x', pageVersion: 1 }));
    assert.equal((await brief(['state', '--data', data])).code, 4);
  });
});

describe('context', () => {
  let data;

  beforeEach(async () => {
    data = tempDir('data');
    await brief(['state', '--data', data, '--set-url', ARTIFACT, '--page-version', '1']);
  });

  it('exits 4 before looking at git when brief is not set up', async () => {
    const result = await brief(['context', '--data', tempDir('empty')], { cwd: tempDir('plain') });
    assert.equal(result.code, 4);
  });

  it('exits 3 outside a git worktree', async () => {
    const result = await brief(['context', '--data', data], { cwd: tempDir('plain') });
    assert.equal(result.code, 3);
    assert.match(result.err, /not in a git worktree/);
  });

  it('prints the facts for a repo with a credentialed https origin', async () => {
    const repo = makeRepo({ origin: 'https://user:ghp_secret123@GitHub.com:443/acme/widgets.git' });
    const head = git(repo, 'rev-parse', 'HEAD');
    const result = await brief(['context', '--data', data], { cwd: repo });
    assert.equal(result.code, 0);
    assert.equal(result.out.includes('ghp_secret123'), false);
    assert.deepEqual(result.json(), {
      url: ARTIFACT,
      repo: 'github.com/acme/widgets',
      repoName: 'widgets',
      host: 'laptop',
      worktree: repo,
      branch: 'main',
      head,
      ts: '2026-10-09T23:15:00Z',
      docId: '20261009T231500Z-a1b2c3',
    });
  });

  it('honors --cwd over the process directory', async () => {
    const repo = makeRepo({ origin: 'git@github.com:acme/widgets.git' });
    const result = await brief(['context', '--data', data, '--cwd', repo], { cwd: tempDir('plain') });
    assert.equal(result.code, 0);
    assert.equal(result.json().worktree, repo);
  });

  it('resolves a subdirectory to the worktree root', async () => {
    const repo = makeRepo();
    mkdirSync(join(repo, 'src'));
    const result = await brief(['context', '--data', data, '--cwd', join(repo, 'src')]);
    assert.equal(result.json().worktree, repo);
  });

  it('uses a stable local key across the main and a linked worktree', async () => {
    const repo = makeRepo();
    const linked = join(tempDir('linked'), 'wt');
    git(repo, 'worktree', 'add', '-b', 'feat/x', linked);
    const mainFacts = (await brief(['context', '--data', data], { cwd: repo })).json();
    const other = (await brief(['context', '--data', data], { cwd: linked })).json();
    assert.match(mainFacts.repo, /^local\/.+-[0-9a-f]{8}$/);
    assert.equal(other.repo, mainFacts.repo);
    assert.equal(other.repoName, mainFacts.repoName);
    assert.equal(other.worktree, linked);
    assert.equal(other.branch, 'feat/x');
    assert.notEqual(other.worktree, mainFacts.worktree);
  });

  it('labels a detached head', async () => {
    const repo = makeRepo();
    const head = git(repo, 'rev-parse', 'HEAD');
    git(repo, 'checkout', '--detach');
    const result = await brief(['context', '--data', data], { cwd: repo });
    assert.equal(result.json().branch, `detached@${head.slice(0, 7)}`);
    assert.equal(result.json().head, head);
  });

  it('names the branch even when a tag has the same name', async () => {
    const repo = makeRepo();
    git(repo, 'checkout', '-b', 'feat/x');
    git(repo, 'tag', 'feat/x');
    const result = await brief(['context', '--data', data], { cwd: repo });
    assert.equal(result.json().branch, 'feat/x');
  });

  it('exits 3 when --cwd does not exist', async () => {
    const result = await brief(['context', '--data', data, '--cwd', join(tempDir('plain'), 'missing')]);
    assert.equal(result.code, 3);
    assert.match(result.err, /not in a git worktree/);
  });

  it('handles an unborn branch', async () => {
    const repo = tempDir('unborn');
    git(repo, 'init', '-b', 'main');
    const json = (await brief(['context', '--data', data], { cwd: repo })).json();
    assert.equal(json.branch, 'main');
    assert.equal(json.head, null);
  });
});

describe('worktrees', () => {
  it('exits 3 outside a git worktree', async () => {
    const result = await brief(['worktrees', '--data', '/d'], { cwd: tempDir('plain') });
    assert.equal(result.code, 3);
  });

  it('lists rows for a main and a linked worktree', async () => {
    const repo = makeRepo();
    const linked = join(tempDir('linked'), 'wt');
    git(repo, 'worktree', 'add', '-b', 'feat/x', linked);
    writeFileSync(join(linked, 'new.txt'), 'x\n');
    writeFileSync(join(linked, 'a.txt'), 'changed\n');
    const head = git(repo, 'rev-parse', 'HEAD');
    const result = await brief(['worktrees', '--data', '/d'], { cwd: repo });
    assert.equal(result.code, 0);
    assert.deepEqual(result.json(), {
      worktrees: [
        { path: repo, branch: 'main', head, isMain: true, prunable: false, ahead: null, behind: null, dirtyCount: 0 },
        { path: linked, branch: 'feat/x', head, isMain: false, prunable: false, ahead: null, behind: null, dirtyCount: 2 },
      ],
    });
  });

  it('reports ahead and behind against an upstream', async () => {
    const repo = makeRepo();
    const remote = join(tempDir('remote'), 'remote.git');
    git(repo, 'init', '--bare', '-b', 'main', remote);
    git(repo, 'remote', 'add', 'origin', remote);
    git(repo, 'push', '-u', 'origin', 'main');
    const other = join(tempDir('other'), 'clone');
    git(repo, 'clone', remote, other);
    writeFileSync(join(other, 'upstream.txt'), 'u\n');
    git(other, 'add', 'upstream.txt');
    git(other, 'commit', '-m', 'upstream');
    git(other, 'push', 'origin', 'main');
    writeFileSync(join(repo, 'local.txt'), 'l\n');
    git(repo, 'add', 'local.txt');
    git(repo, 'commit', '-m', 'local');
    git(repo, 'fetch', 'origin');
    const [row] = (await brief(['worktrees', '--data', '/d'], { cwd: repo })).json().worktrees;
    assert.equal(row.ahead, 1);
    assert.equal(row.behind, 1);
  });

  it('marks a worktree whose directory was deleted as prunable', async () => {
    const repo = makeRepo();
    const linked = join(tempDir('linked'), 'wt');
    git(repo, 'worktree', 'add', '-b', 'feat/x', linked);
    rmSync(linked, { recursive: true });
    const rows = (await brief(['worktrees', '--data', '/d'], { cwd: repo })).json().worktrees;
    assert.equal(rows[1].prunable, true);
    assert.equal(rows[1].dirtyCount, null);
  });

  describe('with a stubbed git', () => {
    const facts = { worktree: '/r/main', commonDir: '/r/main/.git', originUrl: null, branch: 'main', head: 'a'.repeat(40) };
    const row = (overrides) => ({ path: '/r/main', head: 'a'.repeat(40), branch: 'main', bare: false, prunable: false, isMain: true, ...overrides });

    function stubGit({ rows, status }) {
      const statusCalls = [];
      return {
        statusCalls,
        repoFacts: async () => facts,
        listWorktrees: async () => rows,
        worktreeStatus: async (path) => {
          statusCalls.push(path);
          return status;
        },
      };
    }

    it('exits 1 when git cannot list worktrees', async () => {
      const result = await brief(['worktrees', '--data', '/d'], { git: stubGit({ rows: null }) });
      assert.equal(result.code, 1);
      assert.match(result.err, /could not list git worktrees/);
    });

    it('labels a detached row and leaves a bare row without a branch or status', async () => {
      const bare = row({ path: '/r/bare.git', head: null, branch: null, bare: true });
      const detached = row({ path: '/r/det', branch: null, head: 'b'.repeat(40), isMain: false });
      const stub = stubGit({ rows: [bare, detached], status: { ahead: 1, behind: 2, dirtyCount: 3 } });
      const result = await brief(['worktrees', '--data', '/d'], { git: stub });
      const [bareRow, detachedRow] = result.json().worktrees;
      assert.deepEqual(bareRow, { path: '/r/bare.git', branch: null, head: null, isMain: true, prunable: false, ahead: null, behind: null, dirtyCount: null });
      assert.equal(detachedRow.branch, `detached@${'b'.repeat(7)}`);
      assert.deepEqual([detachedRow.ahead, detachedRow.behind, detachedRow.dirtyCount], [1, 2, 3]);
      assert.deepEqual(stub.statusCalls, ['/r/det']);
    });
  });

  describe('--pr', () => {
    const prs = [
      { number: 7, state: 'OPEN', mergedAt: null, headRefName: 'feat/x', reviewDecision: 'APPROVED', statusCheckRollup: [{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' }] },
      { number: 3, state: 'MERGED', mergedAt: '2026-10-01T00:00:00Z', headRefName: 'feat/x', reviewDecision: '', statusCheckRollup: [] },
    ];

    it('adds the PR matched by branch', async () => {
      const repo = makeRepo();
      const linked = join(tempDir('linked'), 'wt');
      git(repo, 'worktree', 'add', '-b', 'feat/x', linked);
      const { gh, calls } = ghWith({ code: 0, stdout: JSON.stringify(prs), stderr: '' });
      const result = await brief(['worktrees', '--data', '/d', '--pr'], { cwd: repo, gh });
      assert.equal(result.code, 0);
      const [mainRow, featRow] = result.json().worktrees;
      assert.equal(mainRow.pr, null);
      assert.deepEqual(featRow.pr, { number: 7, state: 'OPEN', mergedAt: null, ci: 'success', reviewDecision: 'APPROVED' });
      assert.equal(calls.length, 1);
      assert.deepEqual(calls[0].args.slice(0, 6), ['pr', 'list', '--state', 'all', '--limit', '200']);
      assert.equal(calls[0].opts.cwd, repo);
    });

    it('omits pr fields and reports prError when gh is missing', async () => {
      const repo = makeRepo();
      const { gh } = ghWith({ code: 127, stdout: '', stderr: 'gh: command not found' });
      const result = await brief(['worktrees', '--data', '/d', '--pr'], { cwd: repo, gh });
      assert.equal(result.code, 0);
      const json = result.json();
      assert.match(json.prError, /gh CLI not found/);
      assert.equal('pr' in json.worktrees[0], false);
    });

    it('does not call gh without --pr', async () => {
      const repo = makeRepo();
      const { gh, calls } = ghWith({ code: 0, stdout: '[]', stderr: '' });
      await brief(['worktrees', '--data', '/d'], { cwd: repo, gh });
      assert.equal(calls.length, 0);
    });
  });
});

describe('tidy', () => {
  let repo;
  let linked;
  let saved;

  function entryData(overrides) {
    return {
      v: 1,
      repo: 'github.com/acme/widgets',
      repoName: 'widgets',
      host: 'laptop',
      worktree: repo,
      branch: 'main',
      head: 'abc1234',
      ts: '2026-10-08T10:00:00Z',
      status: 'working',
      changed: 'x',
      decided: [],
      next: '',
      needs_you: null,
      pr: null,
      ...overrides,
    };
  }

  function save(name, content) {
    mkdirSync(join(saved, 'entries'), { recursive: true });
    writeFileSync(join(saved, 'entries', `${name}.json`), typeof content === 'string' ? content : JSON.stringify(content));
  }

  beforeEach(() => {
    repo = makeRepo({ origin: 'https://github.com/acme/widgets.git' });
    linked = join(tempDir('linked'), 'wt');
    git(repo, 'worktree', 'add', '-b', 'feat/x', linked);
    saved = tempDir('saved');
  });

  it('exits 3 outside a git worktree', async () => {
    const result = await brief(['tidy', '--data', '/d', '--entries', saved], { cwd: tempDir('plain') });
    assert.equal(result.code, 3);
  });

  describe('over saved files', () => {
    const noPrs = () => ghWith({ code: 0, stdout: '[]', stderr: '' }).gh;

    async function tidyJson(overrides = {}) {
      const result = await brief(['tidy', '--data', '/d', '--entries', saved], { cwd: repo, gh: noPrs(), ...overrides });
      assert.equal(result.code, 0);
      return result.json();
    }

    it('archives a removed worktree with the exact entry', async () => {
      save('20261008T100000Z-gone01', { version: 4, data: entryData({ worktree: '/nowhere/wt', branch: 'feat/gone', pr: 9 }) });
      const json = await tidyJson();
      assert.equal(json.archive.length, 1);
      assert.equal(json.archive[0].length, 1);
      assert.equal(json.archive[0][0].doc_id, '20261009T231500Z-a1b2c3');
      assert.deepEqual(json.archive[0][0].data, {
        v: 1,
        repo: 'github.com/acme/widgets',
        repoName: 'widgets',
        host: 'laptop',
        worktree: '/nowhere/wt',
        branch: 'feat/gone',
        head: 'abc1234',
        ts: '2026-10-09T23:15:00Z',
        status: 'archived',
        changed: 'Worktree removed.',
        decided: [],
        next: '',
        needs_you: null,
        pr: 9,
      });
      assert.deepEqual(json.prune, []);
      assert.equal(json.skipped, 0);
      assert.equal('prError' in json, false);
    });

    it('leaves live worktrees and other hosts alone', async () => {
      save('20261008T100000Z-main01', { version: 1, data: entryData() });
      save('20261008T100000Z-feat01', { version: 1, data: entryData({ worktree: linked, branch: 'feat/x' }) });
      save('20261008T100000Z-other1', { version: 1, data: entryData({ host: 'desktop', worktree: '/nowhere/other' }) });
      const json = await tidyJson();
      assert.deepEqual(json.archive, []);
    });

    it('prunes old entries pinned to their version, reading both file layouts', async () => {
      save('20261008T090000Z-main01', { version: 1, data: entryData({ ts: '2026-10-08T09:00:00Z' }) });
      save('20260601T000000Z-old001', { version: 2, data: entryData({ ts: '2026-06-01T00:00:00Z' }) });
      save('20261008T100000Z-flat01', { ...entryData({ worktree: linked, branch: 'feat/x' }), version: 6, id: 'ignored' });
      save('20260501T000000Z-flat02', { ...entryData({ worktree: linked, branch: 'feat/x', ts: '2026-05-01T00:00:00Z' }), version: 7 });
      const json = await tidyJson();
      assert.equal(json.prune.length, 1);
      const writes = json.prune[0].sort((x, y) => (x.doc_id < y.doc_id ? -1 : 1));
      assert.deepEqual(writes, [
        { op: 'delete', collection: 'entries', doc_id: '20260501T000000Z-flat02', if_version: 7 },
        { op: 'delete', collection: 'entries', doc_id: '20260601T000000Z-old001', if_version: 2 },
      ]);
    });

    it('counts an unreadable file as skipped', async () => {
      save('20261008T100000Z-main01', { version: 1, data: entryData() });
      save('20261008T100000Z-broken', '{not json');
      const json = await tidyJson();
      assert.equal(json.skipped, 1);
    });

    it('counts an old entry without a version as skipped and does not prune it', async () => {
      save('20261008T090000Z-main01', { version: 1, data: entryData({ ts: '2026-10-08T09:00:00Z' }) });
      save('20260501T000000Z-flat02', entryData({ ts: '2026-05-01T00:00:00Z' }));
      const json = await tidyJson();
      assert.deepEqual(json.prune, []);
      assert.equal(json.skipped, 1);
    });

    it('does not archive the worktrees of a second clone of the same origin', async () => {
      const otherClone = makeRepo({ origin: 'https://github.com/acme/widgets.git' });
      const otherLinked = join(tempDir('linked'), 'wt');
      git(otherClone, 'worktree', 'add', '-b', 'feat/y', otherLinked);
      save('20261008T100000Z-clone1', { version: 1, data: entryData({ worktree: otherClone }) });
      save('20261008T100000Z-clone2', { version: 1, data: entryData({ worktree: otherLinked, branch: 'feat/y' }) });
      const json = await tidyJson();
      assert.deepEqual(json.archive, []);
    });

    it('exits 1 when git cannot list worktrees', async () => {
      const stub = { repoFacts: async () => ({ worktree: repo, commonDir: join(repo, '.git'), originUrl: null, branch: 'main', head: null }), listWorktrees: async () => null };
      const result = await brief(['tidy', '--data', '/d', '--entries', saved], { git: stub, gh: noPrs() });
      assert.equal(result.code, 1);
      assert.match(result.err, /could not list git worktrees/);
    });
  });

  it('archives a worktree whose branch PR merged after its latest entry', async () => {
    save('20261008T100000Z-feat01', { version: 1, data: entryData({ worktree: linked, branch: 'feat/x' }) });
    const prs = [{ number: 11, state: 'MERGED', mergedAt: '2026-10-09T08:00:00Z', headRefName: 'feat/x', reviewDecision: null, statusCheckRollup: [] }];
    const { gh } = ghWith({ code: 0, stdout: JSON.stringify(prs), stderr: '' });
    const result = await brief(['tidy', '--data', '/d', '--entries', saved], { cwd: repo, gh });
    const [[write]] = result.json().archive;
    assert.equal(write.data.changed, 'PR #11 merged.');
    assert.equal(write.data.pr, 11);
  });

  it('reports prError and still archives removed worktrees when gh fails', async () => {
    save('20261008T100000Z-gone01', { version: 1, data: entryData({ worktree: '/nowhere/wt' }) });
    const { gh } = ghWith({ code: 127, stdout: '', stderr: '' });
    const result = await brief(['tidy', '--data', '/d', '--entries', saved], { cwd: repo, gh });
    assert.equal(result.code, 0);
    assert.match(result.json().prError, /gh CLI not found/);
    assert.equal(result.json().archive.length, 1);
  });

  it('accepts the entries directory itself', async () => {
    save('20261008T100000Z-gone01', { version: 1, data: entryData({ worktree: '/nowhere/wt' }) });
    const { gh } = ghWith({ code: 0, stdout: '[]', stderr: '' });
    const result = await brief(['tidy', '--data', '/d', '--entries', join(saved, 'entries')], { cwd: repo, gh });
    assert.equal(result.json().archive.length, 1);
  });

  it('exits 1 when the entries directory cannot be read', async () => {
    const { gh } = ghWith({ code: 0, stdout: '[]', stderr: '' });
    const result = await brief(['tidy', '--data', '/d', '--entries', join(saved, 'missing')], { cwd: repo, gh });
    assert.equal(result.code, 1);
    assert.match(result.err, /^brief: /);
  });
});
