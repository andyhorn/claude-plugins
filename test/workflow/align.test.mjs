import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const SKILL_DIR = fileURLToPath(new URL('../../plugins/workflow/skills/align/', import.meta.url));
const SKILL_PATH = resolve(SKILL_DIR, 'SKILL.md');
const TEMPLATE_PATH = resolve(SKILL_DIR, 'references', 'brief-template.md');

const REQUIRED_SECTIONS = [
  'Goal',
  'Why now',
  'Affected',
  'In scope',
  'Out of scope',
  'Glossary',
  'Constraints',
  'Assumptions',
  'Success test',
  'Open unknowns',
  'Divergence log',
  'Dissent',
  'Confirmation',
];

function sectionsOf(source) {
  return [...source.matchAll(/^## (.+)$/gm)].map((match) => match[1].trim());
}

function frontmatterOf(source) {
  const lines = source.split('\n');
  assert.equal(lines[0], '---', 'template starts with frontmatter');
  const close = lines.indexOf('---', 1);
  assert.ok(close > 0, 'template closes its frontmatter');
  return lines.slice(1, close).join('\n');
}

function fieldOf(frontmatter, field) {
  const line = frontmatter.split('\n').find((candidate) => candidate.startsWith(`${field}:`));
  return line ? line.slice(field.length + 1).trim() : undefined;
}

function tableColumnsOf(source, heading) {
  const lines = source.split('\n');
  const start = lines.indexOf(`## ${heading}`);
  assert.ok(start >= 0, `${heading} section exists`);
  const header = lines.slice(start).find((line) => line.startsWith('|'));
  assert.ok(header, `${heading} has a table`);
  return header.split('|').slice(1, -1).map((cell) => cell.trim());
}

function sectionBodyOf(source, heading) {
  const lines = source.split('\n');
  const start = lines.indexOf(`## ${heading}`);
  assert.ok(start >= 0, `${heading} section exists`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('## '));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n');
}

describe('align skill', () => {
  it('keeps unquoted frontmatter values free of ": "', () => {
    for (const [name, path] of [
      ['SKILL.md', SKILL_PATH],
      ['brief-template.md', TEMPLATE_PATH],
    ]) {
      const frontmatter = frontmatterOf(readFileSync(path, 'utf8'));
      for (const line of frontmatter.split('\n')) {
        const colon = line.indexOf(':');
        if (!line || line.startsWith(' ') || line.startsWith('#') || colon < 0) continue;
        const value = line.slice(colon + 1).trim();
        if (!value || /^['">|]/.test(value)) continue;
        assert.ok(!value.includes(': '), `${name} must quote a value containing ": " — ${line}`);
      }
    }
  });

  it('links to a brief template that exists', () => {
    const source = readFileSync(SKILL_PATH, 'utf8');
    assert.match(source, /\]\(references\/brief-template\.md\)/, 'skill links to the template');
    assert.ok(existsSync(TEMPLATE_PATH), 'template file exists');
  });

  it('names the default brief path', () => {
    const source = readFileSync(SKILL_PATH, 'utf8');
    assert.ok(source.includes('docs/alignment/YYYY-MM-DD-<slug>.md'), 'default path is documented');
  });

  it('documents the path override contract', () => {
    const brief = sectionBodyOf(readFileSync(SKILL_PATH, 'utf8'), 'The brief file');
    assert.match(brief, /explicit path argument/i, 'override is documented');
    assert.match(brief, /existing file is loaded/i, 'existing brief is loaded');
    assert.match(brief, /existing directory/i, 'existing directory is handled');
    assert.match(brief, /path that does not exist is the write target/i, 'missing path is the write target');
    assert.match(brief, /explicit path beats the default/i, 'override takes precedence');
    assert.match(brief, /ask one clarifying question/i, 'ambiguous arguments are clarified');
    assert.match(brief, /create `docs\/alignment\/`/i, 'default directory is created');
    assert.match(brief, /\*-<slug>\.md/, 'existing briefs are found by slug');
  });

  it('template declares task, date and a draft status', () => {
    const frontmatter = frontmatterOf(readFileSync(TEMPLATE_PATH, 'utf8'));
    assert.ok(fieldOf(frontmatter, 'task'), 'template declares a task');
    assert.equal(fieldOf(frontmatter, 'date'), 'YYYY-MM-DD', 'template declares a date placeholder');
    assert.equal(fieldOf(frontmatter, 'status'), 'draft', 'template starts as a draft');
  });

  it('template has every required section exactly once', () => {
    const sections = sectionsOf(readFileSync(TEMPLATE_PATH, 'utf8'));
    for (const heading of REQUIRED_SECTIONS) {
      assert.equal(sections.filter((section) => section === heading).length, 1, `${heading} appears once`);
    }
  });

  it('template keeps the glossary and divergence log tables intact', () => {
    const source = readFileSync(TEMPLATE_PATH, 'utf8');
    assert.deepEqual(tableColumnsOf(source, 'Glossary'), ['Term', 'Definition', 'Example', 'Non-example', 'Source']);
    assert.deepEqual(tableColumnsOf(source, 'Divergence log'), ['Claim or term', 'My reading', 'Your reading', 'Status']);
    assert.deepEqual(tableColumnsOf(source, 'Constraints'), ['Constraint', 'Kind', 'Source']);
    assert.deepEqual(tableColumnsOf(source, 'Open unknowns'), ['Question', 'Cost if wrong', 'Owner']);
  });

  it('template records understanding, agreement and settlement separately', () => {
    const confirmation = sectionBodyOf(readFileSync(TEMPLATE_PATH, 'utf8'), 'Confirmation');
    for (const state of ['Understood', 'Agreed', 'Settled']) {
      assert.match(confirmation, new RegExp(`^- ${state}:`, 'm'), `${state} is recorded`);
    }
  });
});
