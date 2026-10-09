import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPTS_DIR = fileURLToPath(new URL('../../plugins/deps/scripts/', import.meta.url));
const CORE_DIR = join(SCRIPTS_DIR, 'lib', 'core');

const IMPURE = /from 'node:|process\.|fetch\(|Date\.now|new Date\(\)/;
const WRITE_VERB_LITERAL = /"(merge|review|edit|close)"/;

function sourcesIn(directory, { recursive }) {
  const entries = readdirSync(directory, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return recursive ? sourcesIn(path, { recursive }) : [];
    }
    return entry.name.endsWith('.mjs') ? [path] : [];
  });
}

describe('source rules', () => {
  const coreFiles = sourcesIn(CORE_DIR, { recursive: false });
  const allFiles = sourcesIn(SCRIPTS_DIR, { recursive: true });

  it('finds the sources it is meant to scan', () => {
    assert.ok(coreFiles.length > 0);
    assert.ok(allFiles.length >= coreFiles.length);
  });

  for (const file of coreFiles) {
    it(`keeps ${file.slice(SCRIPTS_DIR.length)} pure`, () => {
      const lines = readFileSync(file, 'utf8').split('\n');
      const offending = lines.filter((line) => IMPURE.test(line));
      assert.deepEqual(offending, []);
    });
  }

  for (const file of allFiles) {
    it(`has no write verb literal in ${file.slice(SCRIPTS_DIR.length)}`, () => {
      const lines = readFileSync(file, 'utf8').split('\n');
      const offending = lines.filter((line) => WRITE_VERB_LITERAL.test(line));
      assert.deepEqual(offending, []);
    });
  }
});
