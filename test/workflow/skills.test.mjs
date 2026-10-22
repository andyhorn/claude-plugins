import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const SKILLS_DIR = fileURLToPath(new URL('../../plugins/workflow/skills/', import.meta.url));

const VERDICT_PREFIX = {
  Necessary: 'N',
  Beneficial: 'B',
  Defer: 'F',
  Discard: 'D',
};

function skillDirs() {
  return readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      dir: resolve(SKILLS_DIR, entry.name),
      path: resolve(SKILLS_DIR, entry.name, 'SKILL.md'),
    }))
    .filter((skill) => existsSync(skill.path));
}

function frontmatterOf(source, skill) {
  const lines = source.split('\n');
  assert.equal(lines[0], '---', `${skill} starts with frontmatter`);
  const close = lines.indexOf('---', 1);
  assert.ok(close > 0, `${skill} closes its frontmatter`);
  return lines.slice(1, close).join('\n');
}

function fieldOf(frontmatter, field) {
  const line = frontmatter.split('\n').find((candidate) => candidate.startsWith(`${field}:`));
  return line ? line.slice(field.length + 1).trim() : undefined;
}

describe('workflow skills', () => {
  for (const skill of skillDirs()) {
    it(`${skill.name} has valid frontmatter`, () => {
      const source = readFileSync(skill.path, 'utf8');
      const frontmatter = frontmatterOf(source, skill.name);

      assert.equal(fieldOf(frontmatter, 'name'), skill.name, `${skill.name} name matches its directory`);

      const description = fieldOf(frontmatter, 'description');
      assert.ok(description, `${skill.name} declares a description`);
      assert.ok(description.length > 60, `${skill.name} description says when to use it`);
      assert.ok(description.length <= 1024, `${skill.name} description fits the skill limit`);
    });

    it(`${skill.name} references only files that exist`, () => {
      const source = readFileSync(skill.path, 'utf8');
      const links = source.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g);

      for (const [, target] of links) {
        if (/^(https?:|mailto:|#|\/)/.test(target)) continue;
        const path = resolve(skill.dir, target.split('#')[0]);
        assert.ok(existsSync(path), `${skill.name} links to missing file: ${target}`);
      }
    });
  }

  it('triage rule ids are unique and match their verdict section', () => {
    const path = resolve(SKILLS_DIR, 'triage', 'references', 'verdict-rules.md');
    const lines = readFileSync(path, 'utf8').split('\n');

    let section;
    const seen = new Set();
    const counts = new Map();

    for (const line of lines) {
      const heading = line.match(/^## (Necessary|Beneficial|Defer|Discard)$/);
      if (heading) {
        section = heading[1];
        continue;
      }

      const rule = line.match(/^### ([DNBF])(\d+) · /);
      if (!rule) continue;

      const [, prefix, number] = rule;
      const id = `${prefix}${number}`;
      assert.ok(section, `${id} appears under a verdict section`);
      assert.equal(prefix, VERDICT_PREFIX[section], `${id} belongs under ${section}`);
      assert.ok(!seen.has(id), `${id} is declared once`);
      seen.add(id);
      counts.set(section, (counts.get(section) ?? 0) + 1);
    }

    for (const verdict of Object.keys(VERDICT_PREFIX)) {
      assert.ok(counts.get(verdict) > 0, `${verdict} has at least one rule`);
    }
  });
});
