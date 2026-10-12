import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { classify, classifyAll } from '../../plugins/deps/scripts/lib/core/classify.mjs';
import { toSnapshot } from '../../plugins/deps/scripts/lib/core/snapshot.mjs';
import { applySet, loadFixture, loadRaw } from './helpers.mjs';

const FACT_ORDER = [
  'author',
  'provenance',
  'draft',
  'base',
  'head',
  'bumps',
  'ci',
  'mergeability',
  'security',
];

const REQUIRED_SCENARIOS = [
  'provenance-unverified',
  'provenance-non-web-flow-signer',
  'provenance-spoofed-author',
  'provenance-cross-repo',
  'draft',
  'non-default-base',
  'head-moved',
  'ci-green',
  'ci-running',
  'ci-failing',
  'ci-empty',
  'ci-all-skipped',
  'mergeability-conflicting',
  'mergeability-unknown',
  'mergeability-behind',
  'mergeability-blocked',
  'bumps-patch',
  'bumps-minor',
  'bumps-major',
  'bumps-0x-minor-is-major',
  'bumps-00x-patch-is-major',
  'bumps-missing-metadata',
  'bumps-sha-pinned-no-update-type',
  'bumps-grouped-mixed',
  'renovate',
  'security-alert-fixed',
  'security-alert-not-fixed',
  'security-alerts-unavailable',
  'security-label',
];

const fixture = loadFixture('scenarios.json');

function snapshotFor(scenario) {
  const raw = scenario.raw ?? fixture.base.raw;
  const snapshot = toSnapshot(loadRaw(raw));
  const usesBase = raw === fixture.base.raw;
  const start = usesBase ? applySet(snapshot, fixture.base.set) : snapshot;
  return applySet(start, scenario.set);
}

function expectedFacts(scenario) {
  const usesBase = (scenario.raw ?? fixture.base.raw) === fixture.base.raw;
  const baseByName = new Map(fixture.base.expected.facts.map((fact) => [fact.fact, fact]));
  return FACT_ORDER.map((name) => {
    const override = scenario.expected.facts[name];
    if (override) {
      return { fact: name, status: override.status, evidence: override.evidence };
    }
    assert.ok(usesBase, `scenario on ${scenario.raw} must spell out the ${name} fact in full`);
    return baseByName.get(name);
  });
}

describe('applySet', () => {
  it('assigns nested paths and array indexes on a copy', () => {
    const original = { a: { b: [{ c: 1 }] } };
    const result = applySet(original, { 'a.b.0.c': 2, 'a.b.1': { c: 3 }, 'a.d.e': true });
    assert.deepEqual(result, { a: { b: [{ c: 2 }, { c: 3 }], d: { e: true } } });
    assert.deepEqual(original, { a: { b: [{ c: 1 }] } });
  });

  it('copies assigned values so scenarios cannot share state', () => {
    const value = { x: 1 };
    const result = applySet({}, { v: value });
    result.v.x = 2;
    assert.equal(value.x, 1);
  });
});

describe('scenarios.json', () => {
  it('contains every required scenario id', () => {
    const present = Object.keys(fixture.scenarios);
    const missing = REQUIRED_SCENARIOS.filter((id) => !present.includes(id));
    assert.deepEqual(missing, []);
  });

  it('starts from a routine baseline', () => {
    const result = classify(applySet(toSnapshot(loadRaw(fixture.base.raw)), fixture.base.set));
    assert.equal(result.bucket, fixture.base.expected.bucket);
    assert.equal(fixture.base.expected.bucket, 'routine');
    assert.deepEqual(result.facts, fixture.base.expected.facts);
  });

  for (const [id, scenario] of Object.entries(fixture.scenarios)) {
    it(`classifies ${id}`, () => {
      const result = classify(snapshotFor(scenario), { alerts: scenario.alerts });
      assert.deepEqual(
        { bucket: result.bucket, facts: result.facts },
        { bucket: scenario.expected.bucket, facts: expectedFacts(scenario) },
      );
    });
  }

  it('changes nothing but the listed facts relative to the baseline', () => {
    const baseByName = new Map(fixture.base.expected.facts.map((fact) => [fact.fact, fact]));
    for (const [id, scenario] of Object.entries(fixture.scenarios)) {
      if (scenario.raw !== undefined) {
        continue;
      }
      const listed = Object.keys(scenario.expected.facts);
      const unlisted = FACT_ORDER.filter((name) => !listed.includes(name));
      const result = classify(snapshotFor(scenario), { alerts: scenario.alerts });
      for (const name of unlisted) {
        const fact = result.facts.find((candidate) => candidate.fact === name);
        assert.deepEqual(fact, baseByName.get(name), `${id}: ${name}`);
      }
    }
  });
});

describe('classifyAll ordering', () => {
  function snapshotOf(id) {
    return snapshotFor(fixture.scenarios[id]);
  }

  function numbered(id, number, extra = {}) {
    return applySet(snapshotOf(id), { 'pr.number': number, 'pr.url': `https://example.test/pull/${number}`, ...extra });
  }

  function routineSnapshot(number, extra = {}) {
    const base = applySet(toSnapshot(loadRaw(fixture.base.raw)), fixture.base.set);
    return applySet(base, { 'pr.number': number, 'pr.url': `https://example.test/pull/${number}`, ...extra });
  }

  it('orders buckets by precedence', () => {
    const snapshots = [
      routineSnapshot(1),
      numbered('bumps-major', 2),
      numbered('ci-failing', 3),
      numbered('ci-running', 4),
      numbered('draft', 5),
    ];
    const buckets = classifyAll(snapshots).map((result) => result.bucket);
    assert.deepEqual(buckets, ['attention', 'waiting', 'blocked', 'needs-analysis', 'routine']);
  });

  it('puts security PRs first within a bucket, then orders by number', () => {
    const snapshots = [
      routineSnapshot(30),
      routineSnapshot(10),
      routineSnapshot(20, { 'pr.labels': ['security'] }),
      routineSnapshot(40, { 'pr.labels': ['Security'] }),
    ];
    const ordered = classifyAll(snapshots).map((result) => [result.number, result.security]);
    assert.deepEqual(ordered, [[20, true], [40, true], [10, false], [30, false]]);
  });

  it('ranks a PR that fixes an alert ahead of unflagged PRs in its bucket', () => {
    const alerts = {
      available: true,
      items: [
        { ghsa: 'GHSA-aaaa-aaaa-aaaa', severity: 'high', summary: 's', ecosystem: 'npm', package: 'fast-json-stringify', patched: '6.3.1' },
      ],
    };
    const unrelated = routineSnapshot(5, {
      'commits.items.0.message': fixture.base.set['commits.items.0.message'].replaceAll('fast-json-stringify', 'other-package'),
    });
    const flagged = classifyAll([unrelated, routineSnapshot(30)], { alerts }).map((result) => [result.number, result.security]);
    assert.deepEqual(flagged, [[30, true], [5, false]]);
  });

  it('keeps a security PR in its own bucket rather than promoting it', () => {
    const snapshots = [numbered('draft', 1), routineSnapshot(2, { 'pr.labels': ['security'] })];
    const buckets = classifyAll(snapshots).map((result) => result.bucket);
    assert.deepEqual(buckets, ['attention', 'routine']);
  });
});

describe('determinism', () => {
  const ids = Object.keys(fixture.scenarios);
  const snapshots = ids.map((id, index) => applySet(snapshotFor(fixture.scenarios[id]), {
    'pr.number': index + 1,
    'pr.url': `https://example.test/pull/${index + 1}`,
  }));

  it('gives the same result for reversed and shuffled input', () => {
    const expected = classifyAll(snapshots);
    const reversed = classifyAll([...snapshots].reverse());
    const rotated = classifyAll([...snapshots.slice(7), ...snapshots.slice(0, 7)]);
    const interleaved = classifyAll([
      ...snapshots.filter((_, index) => index % 2 === 0),
      ...snapshots.filter((_, index) => index % 2 === 1),
    ]);
    assert.deepEqual(reversed, expected);
    assert.deepEqual(rotated, expected);
    assert.deepEqual(interleaved, expected);
  });

  it('gives the same result when classifying twice', () => {
    for (const snapshot of snapshots) {
      assert.deepEqual(classify(snapshot), classify(structuredClone(snapshot)));
    }
  });

  it('is deterministic with an alert context', () => {
    const alerts = {
      available: true,
      items: [
        { ghsa: 'GHSA-b', severity: 'low', summary: 's', ecosystem: 'npm', package: 'fast-json-stringify', patched: '6.3.1' },
        { ghsa: 'GHSA-a', severity: 'high', summary: 's', ecosystem: 'npm', package: 'fast-json-stringify', patched: '6.0.0' },
      ],
    };
    const reversedAlerts = { available: true, items: [...alerts.items].reverse() };
    const expected = classifyAll(snapshots, { alerts });
    assert.deepEqual(classifyAll([...snapshots].reverse(), { alerts }), expected);
    assert.deepEqual(classifyAll(snapshots, { alerts: reversedAlerts }), expected);
    assert.deepEqual(classifyAll(structuredClone(snapshots), { alerts: structuredClone(alerts) }), expected);
  });

  it('does not mutate its input', () => {
    const copies = structuredClone(snapshots);
    classifyAll(snapshots);
    assert.deepEqual(snapshots, copies);
  });

  it('keeps evidence free of timestamps', () => {
    for (const result of classifyAll(snapshots)) {
      for (const fact of result.facts) {
        assert.doesNotMatch(fact.evidence, /\d{4}-\d{2}-\d{2}T|\d{2}:\d{2}:\d{2}/);
      }
    }
  });
});
