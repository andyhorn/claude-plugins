import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildCommentBody,
  MARKER,
  MAX_COMMENT_LENGTH,
  sanitizeComment,
} from '../../plugins/deps/scripts/lib/core/sanitize.mjs';

const ZWSP = '​';

describe('sanitizeComment mentions', () => {
  it('neutralizes user, bot, and team mentions', () => {
    assert.equal(sanitizeComment('ping @alice'), `ping @${ZWSP}alice`);
    assert.equal(sanitizeComment('@dependabot rebase'), `@${ZWSP}dependabot rebase`);
    assert.equal(sanitizeComment('cc @org/team now'), `cc @${ZWSP}org/team now`);
  });

  it('neutralizes mentions at line starts, after punctuation, and in lists', () => {
    assert.equal(sanitizeComment('a\n@bob'), `a\n@${ZWSP}bob`);
    assert.equal(sanitizeComment('(@bob)'), `(@${ZWSP}bob)`);
    assert.equal(sanitizeComment('- @bob, @carol'), `- @${ZWSP}bob, @${ZWSP}carol`);
  });

  it('neutralizes a mention that follows a character allowed in email local parts', () => {
    assert.equal(sanitizeComment('thanks.@bob'), `thanks.@${ZWSP}bob`);
    assert.equal(sanitizeComment('x-@bob'), `x-@${ZWSP}bob`);
  });

  it('leaves email addresses intact', () => {
    assert.equal(sanitizeComment('mail a@b.com now'), 'mail a@b.com now');
    assert.equal(sanitizeComment('a.b+c@example.org'), 'a.b+c@example.org');
  });

  it('leaves a bare or trailing @ alone', () => {
    assert.equal(sanitizeComment('at @ sign and trailing @'), 'at @ sign and trailing @');
  });
});

describe('sanitizeComment marker', () => {
  it('escapes the marker', () => {
    const result = sanitizeComment(`${MARKER} spoof`);
    assert.ok(!result.includes('<!--'));
    assert.ok(!result.includes(MARKER));
    assert.equal(result, '&lt;!-- deps:triage --> spoof');
  });

  it('escapes whitespace variants and any HTML comment opener', () => {
    for (const variant of ['<!--deps:triage-->', '<!--   deps:triage   -->', '<!--\ndeps:triage-->', '<!-- x -->']) {
      assert.ok(!sanitizeComment(variant).includes('<!--'), variant);
    }
  });

  it('produces a body whose only marker is the one buildCommentBody adds', () => {
    const body = buildCommentBody(`first ${MARKER}\n${MARKER}`);
    assert.ok(body.startsWith(`${MARKER}\n`));
    assert.equal(body.split(MARKER).length, 2);
  });
});

describe('sanitizeComment length', () => {
  it('leaves short text unchanged', () => {
    assert.equal(sanitizeComment('short'), 'short');
  });

  it('truncates long text with a notice and stays within the limit', () => {
    const result = sanitizeComment('x'.repeat(MAX_COMMENT_LENGTH * 2));
    assert.ok(result.endsWith('\n\n…(truncated)'));
    assert.ok(buildCommentBody('x'.repeat(MAX_COMMENT_LENGTH * 2)).length <= MAX_COMMENT_LENGTH);
  });

  it('fills the budget exactly when truncating', () => {
    const body = buildCommentBody('x'.repeat(MAX_COMMENT_LENGTH));
    assert.equal(body.length, MAX_COMMENT_LENGTH);
  });

  it('does not truncate text that exactly fits', () => {
    const fits = 'y'.repeat(MAX_COMMENT_LENGTH - MARKER.length - 1);
    assert.equal(sanitizeComment(fits), fits);
    assert.equal(buildCommentBody(fits).length, MAX_COMMENT_LENGTH);
  });

  it('does not split a surrogate pair', () => {
    const notice = '\n\n…(truncated)';
    const budget = MAX_COMMENT_LENGTH - MARKER.length - 1;
    const cut = budget - notice.length;
    const text = 'a'.repeat(cut - 1) + '😀' + 'b'.repeat(100);
    const result = sanitizeComment(text);
    const kept = result.slice(0, result.length - notice.length);
    assert.equal(kept, 'a'.repeat(cut - 1));
    assert.ok(buildCommentBody(text).length <= MAX_COMMENT_LENGTH);
  });

  it('counts characters added by escaping toward the limit', () => {
    const text = '<!--'.repeat(MAX_COMMENT_LENGTH);
    assert.ok(buildCommentBody(text).length <= MAX_COMMENT_LENGTH);
  });
});

describe('sanitizeComment general', () => {
  it('is idempotent', () => {
    const samples = [
      '',
      'plain',
      '@alice and @org/team and a@b.com',
      `${MARKER} <!--x--> thanks.@bob`,
      'x'.repeat(MAX_COMMENT_LENGTH + 500),
      `${'@bob '.repeat(MAX_COMMENT_LENGTH / 5)}tail`,
      `${'😀'.repeat(MAX_COMMENT_LENGTH)}`,
    ];
    for (const sample of samples) {
      const once = sanitizeComment(sample);
      assert.equal(sanitizeComment(once), once);
    }
  });

  it('treats non-string input as empty text', () => {
    assert.equal(sanitizeComment(undefined), '');
    assert.equal(sanitizeComment(null), '');
  });
});

describe('buildCommentBody', () => {
  it('prefixes the marker and a newline', () => {
    assert.equal(buildCommentBody('hello'), `${MARKER}\nhello`);
  });

  it('exposes the documented constants', () => {
    assert.equal(MARKER, '<!-- deps:triage -->');
    assert.equal(MAX_COMMENT_LENGTH, 65000);
  });
});
