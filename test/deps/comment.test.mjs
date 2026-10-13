import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MARKER } from '../../plugins/deps/scripts/lib/core/sanitize.mjs';
import { createGitHub, planComment } from '../../plugins/deps/scripts/lib/io/github.mjs';

const BODY = `${MARKER}\nanalysis`;
const mine = (id, body = BODY) => ({ id, login: 'me', body });
const theirs = (id, body = BODY) => ({ id, login: 'mallory', body });

function plan(existingComments) {
  return planComment({ existingComments, viewer: 'me', body: BODY });
}

describe('planComment', () => {
  it('creates when there are no comments', () => {
    assert.deepEqual(plan([]), { action: 'create', body: BODY });
  });

  it('updates the viewer marker comment', () => {
    assert.deepEqual(plan([mine(5)]), { action: 'update', commentId: 5, body: BODY });
  });

  it('never updates a marker comment by another user', () => {
    assert.deepEqual(plan([theirs(3)]), { action: 'create', body: BODY });
  });

  it('updates the viewer comment when another user also has one', () => {
    assert.equal(plan([theirs(3), mine(9)]).commentId, 9);
  });

  it('updates the lowest id among several viewer marker comments', () => {
    assert.equal(plan([mine(12), mine(7), mine(10)]).commentId, 7);
  });

  it('creates when the viewer comment has no marker', () => {
    assert.deepEqual(plan([mine(4, 'hello')]), { action: 'create', body: BODY });
  });
});

function recordingRunner(stdout) {
  const calls = [];
  const run = async (args, opts) => {
    calls.push({ args, input: opts?.input });
    return { code: 0, stdout, stderr: '' };
  };
  return { calls, run };
}

describe('createGitHub comment writes', () => {
  const repo = { owner: 'acme', name: 'widgets' };

  it('createComment posts the body as JSON on stdin and nothing else', async () => {
    const { calls, run } = recordingRunner(JSON.stringify({ id: 11, html_url: 'https://github.com/acme/widgets/pull/1#c11' }));
    const result = await createGitHub({ run }).createComment(repo, 1, BODY);
    assert.deepEqual(result, { id: 11, url: 'https://github.com/acme/widgets/pull/1#c11' });
    assert.deepEqual(calls, [
      {
        args: ['api', '--method', 'POST', 'repos/acme/widgets/issues/1/comments', '--input', '-'],
        input: JSON.stringify({ body: BODY }),
      },
    ]);
  });

  it('updateComment patches the comment by id and nothing else', async () => {
    const { calls, run } = recordingRunner(JSON.stringify({ id: 11, html_url: 'https://github.com/acme/widgets/pull/1#c11' }));
    const result = await createGitHub({ run }).updateComment(repo, 11, BODY);
    assert.deepEqual(result, { id: 11, url: 'https://github.com/acme/widgets/pull/1#c11' });
    assert.deepEqual(calls, [
      {
        args: ['api', '--method', 'PATCH', 'repos/acme/widgets/issues/comments/11', '--input', '-'],
        input: JSON.stringify({ body: BODY }),
      },
    ]);
  });

  it('throws a gh error when the write fails', async () => {
    const run = async () => ({ code: 1, stdout: '', stderr: 'boom' });
    await assert.rejects(createGitHub({ run }).createComment(repo, 1, BODY), (error) => error.kind === 'gh' && /boom/.test(error.message));
  });
});
