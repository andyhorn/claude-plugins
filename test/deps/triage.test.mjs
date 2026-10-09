import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { bumpsOf, classifyAll } from '../../plugins/deps/scripts/lib/core/classify.mjs';
import { MARKER } from '../../plugins/deps/scripts/lib/core/sanitize.mjs';
import { toSnapshot } from '../../plugins/deps/scripts/lib/core/snapshot.mjs';
import { main } from '../../plugins/deps/scripts/triage.mjs';
import { loadRaw } from './helpers.mjs';

const NOW = new Date('2026-10-09T12:00:00.000Z');
const FILES = ['supabase-storage-1495.json', 'rocm-libraries-13313.json', 'renovate-event-store-1038.json'];

function sink() {
  return {
    text: '',
    write(chunk) {
      this.text += chunk;
    },
  };
}

function fakeGh(overrides = {}) {
  const snapshots = new Map(FILES.map((file) => [toSnapshot(loadRaw(file)).pr.number, toSnapshot(loadRaw(file))]));
  const calls = [];
  const gh = {
    calls,
    async preflight() {
      return { nameWithOwner: 'acme/widgets', owner: 'acme', name: 'widgets', defaultBranch: 'main', viewerPermission: 'WRITE' };
    },
    async listBotPrNumbers() {
      return [...snapshots.keys()].sort((a, b) => a - b);
    },
    async fetchSnapshot(_repo, number) {
      calls.push(['fetchSnapshot', number]);
      if (!snapshots.has(number)) {
        throw new Error(`no PR ${number}`);
      }
      return snapshots.get(number);
    },
    async viewerLogin() {
      return 'me';
    },
    async listIssueComments() {
      return [];
    },
    async createComment(_repo, number, body) {
      calls.push(['create', number, body]);
      return { id: 1, url: 'https://example.test/c/1' };
    },
    async updateComment(_repo, id, body) {
      calls.push(['update', id, body]);
      return { id, url: 'https://example.test/c/2' };
    },
    ...overrides,
  };
  return { gh, snapshots };
}

async function run(argv, deps) {
  const stdout = sink();
  const stderr = sink();
  const code = await main(argv, {
    stdout,
    stderr,
    now: () => NOW,
    readFile: async () => 'analysis text',
    ...deps,
  });
  return { code, stdout: stdout.text, stderr: stderr.text };
}

describe('main usage', () => {
  it('exits 2 on bad arguments', async () => {
    const { gh } = fakeGh();
    for (const argv of [[], ['bogus'], ['collect', '--bogus'], ['collect', 'x'], ['comment', '--pr', '1']]) {
      const result = await run(argv, { gh });
      assert.equal(result.code, 2, argv.join(' '));
      assert.match(result.stderr, /usage:/);
    }
  });

  it('exits 6 on an old Node', async () => {
    const { gh } = fakeGh();
    const result = await run(['collect'], { gh, nodeVersion: '20.11.0' });
    assert.equal(result.code, 6);
  });
});

describe('main collect', () => {
  it('prints classified PRs with bumps and the injected time', async () => {
    const { gh, snapshots } = fakeGh();
    const result = await run(['collect'], { gh });
    assert.equal(result.code, 0);
    const output = JSON.parse(result.stdout);
    const expected = classifyAll([...snapshots.values()]);
    assert.equal(output.repo, 'acme/widgets');
    assert.equal(output.defaultBranch, 'main');
    assert.equal(output.collectedAt, '2026-10-09T12:00:00.000Z');
    assert.equal(output.count, expected.length);
    assert.deepEqual(output.prs.map((pr) => pr.number), expected.map((pr) => pr.number));
    for (const pr of output.prs) {
      assert.deepEqual(pr.bumps, bumpsOf(snapshots.get(pr.number)));
    }
    assert.equal(output.errors, undefined);
  });

  it('records a failed PR fetch in errors without aborting', async () => {
    const { gh, snapshots } = fakeGh();
    const [failing] = [...snapshots.keys()];
    const base = gh.fetchSnapshot;
    gh.fetchSnapshot = async (repo, number) => {
      if (number === failing) {
        throw new Error('boom');
      }
      return base(repo, number);
    };
    const result = await run(['collect'], { gh });
    assert.equal(result.code, 0);
    const output = JSON.parse(result.stdout);
    assert.deepEqual(output.errors, [{ number: failing, error: 'boom' }]);
    assert.equal(output.count, snapshots.size - 1);
  });

  it('exits 1 when the requested PR cannot be fetched', async () => {
    const { gh } = fakeGh();
    const result = await run(['collect', '999999'], { gh });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /999999/);
  });
});

describe('main comment', () => {
  it('exits 7 without write access and writes nothing', async () => {
    const { gh } = fakeGh({
      async preflight() {
        return { nameWithOwner: 'acme/widgets', owner: 'acme', name: 'widgets', defaultBranch: 'main', viewerPermission: 'READ' };
      },
    });
    const result = await run(['comment', '--pr', '5', '--body-file', 'x.md'], { gh });
    assert.equal(result.code, 7);
    assert.deepEqual(gh.calls, []);
  });

  it('creates a comment with the marker', async () => {
    const { gh } = fakeGh();
    const result = await run(['comment', '--pr', '5', '--body-file', 'x.md'], { gh });
    assert.equal(result.code, 0);
    assert.deepEqual(JSON.parse(result.stdout), { action: 'create', id: 1, url: 'https://example.test/c/1' });
    assert.equal(gh.calls[0][0], 'create');
    assert.ok(gh.calls[0][2].startsWith(MARKER));
  });

  it('updates the existing viewer marker comment', async () => {
    const { gh } = fakeGh({
      async listIssueComments() {
        return [
          { id: 40, login: 'mallory', body: MARKER },
          { id: 50, login: 'me', body: `${MARKER}\nold` },
        ];
      },
    });
    const result = await run(['comment', '--pr', '5', '--body-file', 'x.md'], { gh });
    assert.equal(result.code, 0);
    assert.deepEqual(JSON.parse(result.stdout), { action: 'update', id: 50, url: 'https://example.test/c/2' });
    assert.deepEqual(gh.calls.map((call) => call[0]), ['update']);
  });
});

describe('main error mapping', () => {
  it('maps GitHub error kinds to exit codes', async () => {
    const { GitHubError } = await import('../../plugins/deps/scripts/lib/io/github.mjs');
    const expected = { auth: 3, repo: 4, archived: 5 };
    for (const [kind, code] of Object.entries(expected)) {
      const { gh } = fakeGh({
        async preflight() {
          throw new GitHubError(kind, `${kind} problem`);
        },
      });
      const result = await run(['collect'], { gh });
      assert.equal(result.code, code);
      assert.match(result.stderr, new RegExp(`${kind} problem`));
    }
  });
});
