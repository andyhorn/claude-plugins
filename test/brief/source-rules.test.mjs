import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPTS_DIR = fileURLToPath(new URL('../../plugins/brief/scripts/', import.meta.url));
const CORE_DIR = join(SCRIPTS_DIR, 'lib', 'core');

const IMPURE = /from ['"]node:|import\(|require\(|process\.|Date\.now|new Date\(\)|fetch\(|randomUUID|Math\.random/;
const TRANSCRIPT_PATH = /transcript_path/;

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

  describe('impurity pattern', () => {
    const impure = [
      "import { x } from 'node:fs';",
      'import { x } from "node:fs";',
      "const m = await import('node:fs');",
      "const m = require('fs');",
      'const id = process.pid;',
      'const t = Date.now();',
      'const d = new Date();',
      'const r = await fetch(url);',
      'const id = randomUUID();',
      'const n = Math.random();',
    ];
    const pure = ["import { x } from './keys.mjs';", 'const d = new Date(text);', 'const t = Date.parse(text);'];

    for (const line of impure) {
      it(`flags ${line}`, () => {
        assert.match(line, IMPURE);
      });
    }

    for (const line of pure) {
      it(`allows ${line}`, () => {
        assert.doesNotMatch(line, IMPURE);
      });
    }
  });

  for (const file of coreFiles) {
    it(`keeps ${file.slice(SCRIPTS_DIR.length)} pure`, () => {
      const lines = readFileSync(file, 'utf8').split('\n');
      const offending = lines.filter((line) => IMPURE.test(line));
      assert.deepEqual(offending, []);
    });
  }

  for (const file of allFiles) {
    it(`never reads transcript_path in ${file.slice(SCRIPTS_DIR.length)}`, () => {
      const lines = readFileSync(file, 'utf8').split('\n');
      const offending = lines.filter((line) => TRANSCRIPT_PATH.test(line));
      assert.deepEqual(offending, []);
    });
  }
});
