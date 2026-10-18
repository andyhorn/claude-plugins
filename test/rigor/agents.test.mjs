import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const READ_ONLY_TOOLS = {
  'work-reviewer': ['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch'],
  operator: ['Read', 'Grep', 'Glob'],
  adversary: ['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch'],
};

function frontmatterOf(agent) {
  const source = readFileSync(new URL(`../../plugins/rigor/agents/${agent}.md`, import.meta.url), 'utf8');
  const lines = source.split('\n');
  assert.equal(lines[0], '---', `${agent} starts with frontmatter`);
  const close = lines.indexOf('---', 1);
  assert.ok(close > 0, `${agent} closes its frontmatter`);
  return lines.slice(1, close).join('\n');
}

function toolsValueOf(agent) {
  const line = frontmatterOf(agent).split('\n').find((candidate) => candidate.startsWith('tools:'));
  assert.ok(line, `${agent} declares a tools line`);
  return line.slice('tools:'.length).trim();
}

describe('rigor agents', () => {
  for (const [agent, expected] of Object.entries(READ_ONLY_TOOLS)) {
    it(`${agent} has exactly its read-only tool set`, () => {
      const value = toolsValueOf(agent);
      assert.ok(value.length > 0, `${agent} tools must be on one line, not a YAML block list`);
      assert.ok(!value.startsWith('['), `${agent} tools must be a plain comma-separated string, not a YAML flow list`);
      assert.deepEqual(value.split(',').map((tool) => tool.trim()).sort(), [...expected].sort());
    });
  }

  it('work-reviewer does not rely on frontmatter hooks, which plugin agents ignore', () => {
    assert.doesNotMatch(frontmatterOf('work-reviewer'), /^hooks:/m);
  });
});
