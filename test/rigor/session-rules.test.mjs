import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../../plugins/rigor/scripts/session-rules.mjs', import.meta.url));
const RULES = new URL('../../plugins/rigor/rules.md', import.meta.url);
const HOOKS = new URL('../../plugins/rigor/hooks/hooks.json', import.meta.url);
const AGENTS = new URL('../../plugins/rigor/agents/', import.meta.url);
const SKILLS = new URL('../../plugins/rigor/skills/', import.meta.url);

function shippedComponents() {
  const agents = readdirSync(AGENTS).filter((file) => file.endsWith('.md')).map((file) => file.replace(/\.md$/, ''));
  const skills = readdirSync(SKILLS, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  return new Set([...agents, ...skills]);
}

describe('session-rules', () => {
  it('prints the rules file to stdout', () => {
    const result = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, readFileSync(RULES, 'utf8'));
  });

  it('names only components the plugin ships', () => {
    const rules = readFileSync(RULES, 'utf8');
    const named = [...rules.matchAll(/`rigor:([a-z-]+)`/g)].map((match) => match[1]);
    const shipped = shippedComponents();
    assert.ok(named.length > 0);
    for (const name of named) {
      assert.ok(shipped.has(name), `${name} is not shipped`);
    }
  });

  it('runs on every session start source', () => {
    const hooks = JSON.parse(readFileSync(HOOKS, 'utf8')).hooks;
    assert.equal(hooks.SessionStart.length, 1);
    assert.equal(hooks.SessionStart[0].matcher, undefined);
  });
});
