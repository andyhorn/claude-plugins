import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { splitSegments } from '../../plugins/deps/scripts/lib/core/shell-segments.mjs';

function texts(command) {
  const segments = splitSegments(command);
  assert.notEqual(segments, null, `expected ${command} to parse`);
  return segments.map((segment) => segment.map((token) => token.text));
}

describe('splitSegments operators', () => {
  it('splits on newlines, semicolons, pipes, and ampersands', () => {
    assert.deepEqual(texts('a 1; b 2\nc 3 | d 4 && e 5 || f 6 & g 7'), [
      ['a', '1'],
      ['b', '2'],
      ['c', '3'],
      ['d', '4'],
      ['e', '5'],
      ['f', '6'],
      ['g', '7'],
    ]);
  });

  it('makes a subshell its own segment', () => {
    assert.deepEqual(texts('a (b c) d'), [['a'], ['b', 'c'], ['d']]);
  });

  it('keeps file descriptor redirections inside the token', () => {
    assert.deepEqual(texts('a 2>&1'), [['a', '2>&1']]);
    assert.deepEqual(texts('a &>out b'), [['a', '&>out', 'b']]);
  });

  it('does not treat an ampersand after a quoted angle bracket as part of a redirection', () => {
    assert.deepEqual(texts("a '>'& b"), [['a', '>'], ['b']]);
  });

  it('returns no segments for an empty command', () => {
    assert.deepEqual(texts(''), []);
    assert.deepEqual(texts('  \t '), []);
  });
});

describe('splitSegments quoting', () => {
  it('treats single quotes as literal', () => {
    assert.deepEqual(texts("a '$(b); c | d'"), [['a', '$(b); c | d']]);
  });

  it('keeps operators inside double quotes', () => {
    assert.deepEqual(texts('a "b | c; d && e"'), [['a', 'b | c; d && e']]);
  });

  it('joins adjacent quoted and unquoted parts into one token', () => {
    assert.deepEqual(texts('g"h"\'x\' y'), [['ghx', 'y']]);
  });

  it('keeps an empty quoted word as a token', () => {
    assert.deepEqual(texts('a "" b'), [['a', '', 'b']]);
  });

  it('removes backslash escapes and line continuations', () => {
    assert.deepEqual(texts('\\gh a\\ b'), [['gh', 'a b']]);
    assert.deepEqual(texts('a \\\n b'), [['a', 'b']]);
    assert.deepEqual(texts('a b\\'), [['a', 'b']]);
  });

  it('honours escapes inside double quotes', () => {
    assert.deepEqual(texts('a "x\\"y\\$z"'), [['a', 'x"y$z']]);
  });
});

describe('splitSegments substitution', () => {
  it('emits a command substitution as its own segment', () => {
    assert.deepEqual(texts('a $(b c) d'), [['b', 'c'], ['a', '$', 'd']]);
  });

  it('emits a backtick substitution as its own segment', () => {
    assert.deepEqual(texts('a `b c`'), [['b', 'c'], ['a', '$']]);
  });

  it('finds substitutions inside double quotes', () => {
    assert.deepEqual(texts('a "x $(b c) y"'), [['b', 'c'], ['a', 'x $ y']]);
    assert.deepEqual(texts('a "`b`"'), [['b'], ['a', '$']]);
  });

  it('nests substitutions', () => {
    assert.deepEqual(texts('a "$(b $(c))"'), [['c'], ['b', '$'], ['a', '$']]);
  });

  it('marks words that contain an expansion as dynamic', () => {
    const [, [, plain, variable, quoted, substitution]] = splitSegments('a p $X "$Y" $(b)');
    assert.equal(plain.dynamic, false);
    assert.equal(variable.dynamic, true);
    assert.equal(quoted.dynamic, true);
    assert.equal(substitution.dynamic, true);
  });
});

describe('splitSegments redirections', () => {
  it('records where the first unquoted output redirection starts', () => {
    const [[, plain, fd, input, quoted]] = splitSegments("a >out 2>err <in '>x'");
    assert.equal(plain.redirectAt, 0);
    assert.equal(fd.redirectAt, 1);
    assert.equal(input.redirectAt, -1);
    assert.equal(quoted.redirectAt, -1);
  });
});

describe('splitSegments unterminated input', () => {
  it('returns null for an open quote or substitution', () => {
    for (const command of ['a "b', "a 'b", 'a $(b', 'a `b', 'a "$(b"', 'a (b']) {
      assert.equal(splitSegments(command), null, command);
    }
  });
});
