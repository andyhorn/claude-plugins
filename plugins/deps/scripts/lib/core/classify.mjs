import {
  compareVersions,
  effectiveLevel,
  parseFromVersions,
  parseUpdatedDependencies,
} from './dependabot-metadata.mjs';

/**
 * @typedef {object} Fact
 * @property {string} fact
 * @property {'ok' | 'fail' | 'pending' | 'none' | 'info'} status
 * @property {string} evidence Deterministic text naming the concrete data behind the status.
 */

/**
 * @typedef {object} Bump
 * @property {string} name
 * @property {string | null} from
 * @property {string} to
 * @property {string | null} dependencyType
 * @property {'major' | 'minor' | 'patch' | null} updateType
 * @property {'major' | 'minor' | 'patch' | 'unknown'} effective
 * @property {string | null} group
 */

/**
 * @typedef {object} Classification
 * @property {number} number
 * @property {string} title
 * @property {string} url
 * @property {string} sha The head commit the facts were evaluated against.
 * @property {'attention' | 'waiting' | 'blocked' | 'needs-analysis' | 'routine'} bucket
 * @property {string[]} reasons Names of the facts that decided the bucket.
 * @property {string} suggestedAction
 * @property {boolean} analyze Whether an impact analysis should be dispatched.
 * @property {boolean} security
 * @property {Bump[]} bumps The dependency updates declared by the PR's first commit.
 * @property {Fact[]} facts
 */

/**
 * @typedef {object} DependabotAlert
 * @property {string} ghsa
 * @property {string} severity
 * @property {string} summary
 * @property {string} ecosystem
 * @property {string} package
 * @property {string | null} patched The first patched version, or null when none exists.
 */

/**
 * @typedef {{ available: true, items: DependabotAlert[] } | { available: false, reason: string }} AlertContext
 */

/**
 * @typedef {object} ClassifyContext
 * @property {AlertContext} [alerts] The repository's open Dependabot alerts, when they were fetched.
 */

/** Bucket names in precedence order. */
export const BUCKETS = Object.freeze(['attention', 'waiting', 'blocked', 'needs-analysis', 'routine']);

const DEPENDABOT_AUTHOR_TYPE = 'Bot';
const DEPENDABOT_AUTHOR_LOGIN = 'dependabot';
const DEPENDABOT_COMMIT_LOGIN = 'dependabot[bot]';
const DEPENDABOT_COMMIT_EMAIL = '49699333+dependabot[bot]@users.noreply.github.com';
const GITHUB_SIGNER = 'web-flow';

const MERGE_STATE_NOTES = {
  BLOCKED: 'BLOCKED: branch protection requirements (such as required reviews) not yet met',
  UNSTABLE: 'UNSTABLE: mergeable, but some commit statuses are not passing',
  HAS_HOOKS: 'HAS_HOOKS: mergeable, with pre-receive hooks',
};

const RUNNING_CHECK_STATES = new Set(['PENDING', 'EXPECTED']);

function short(sha) {
  return sha ? String(sha).slice(0, 7) : 'none';
}

function compareStrings(a, b) {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
}

function plural(count, noun) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function makeFact(fact, status, evidence) {
  return { fact, status, evidence };
}

/**
 * Whether the PR was opened by Dependabot.
 *
 * @param {import('./snapshot.mjs').Snapshot} snapshot
 * @returns {Fact}
 */
export function authorFact(snapshot) {
  const { type, login } = snapshot.pr.author;
  if (type === DEPENDABOT_AUTHOR_TYPE && login === DEPENDABOT_AUTHOR_LOGIN) {
    return makeFact('author', 'ok', `author ${type} ${login}`);
  }
  return makeFact('author', 'fail', `not a Dependabot PR (author ${type} ${login})`);
}

// The numeric-id email is checked because the name and login strings can be spoofed in a fork or by a human author.
function commitProblems(commit) {
  const { signature, author } = commit;
  const problems = [];
  if (!signature.valid) {
    problems.push('unsigned');
  } else {
    if (!signature.signedByGitHub) {
      problems.push('not signed by GitHub');
    }
    if (signature.signer !== GITHUB_SIGNER) {
      problems.push(`signer ${signature.signer}`);
    }
  }
  if (author.email !== DEPENDABOT_COMMIT_EMAIL) {
    problems.push(`author email ${author.email}`);
  }
  if (author.login !== DEPENDABOT_COMMIT_LOGIN) {
    problems.push(`author login ${author.login}`);
  }
  return problems;
}

/**
 * Whether every commit was authored by Dependabot and signed by GitHub, on a same-repository branch.
 *
 * @param {import('./snapshot.mjs').Snapshot} snapshot
 * @returns {Fact}
 */
export function provenanceFact(snapshot) {
  const { commits, pr } = snapshot;
  const problems = [];
  if (pr.isCrossRepository) {
    problems.push('cross-repository');
  }
  if (commits.items.length !== commits.totalCount) {
    problems.push(`only ${commits.items.length} of ${commits.totalCount} commits fetched`);
  }
  for (const commit of commits.items) {
    const reasons = commitProblems(commit);
    if (reasons.length > 0) {
      problems.push(`${short(commit.oid)}: ${reasons.join(', ')}`);
    }
  }
  if (problems.length > 0) {
    return makeFact('provenance', 'fail', problems.join('; '));
  }
  const count = plural(commits.items.length, 'commit');
  return makeFact(
    'provenance',
    'ok',
    `${count} authored by ${DEPENDABOT_COMMIT_LOGIN} and signed by GitHub (${GITHUB_SIGNER}); same-repository branch`,
  );
}

/**
 * Whether the PR is ready for review rather than a draft.
 *
 * @param {import('./snapshot.mjs').Snapshot} snapshot
 * @returns {Fact}
 */
export function draftFact(snapshot) {
  if (snapshot.pr.isDraft) {
    return makeFact('draft', 'fail', 'draft PR');
  }
  return makeFact('draft', 'ok', 'ready for review');
}

/**
 * Whether the PR targets the repository's default branch.
 *
 * @param {import('./snapshot.mjs').Snapshot} snapshot
 * @returns {Fact}
 */
export function baseFact(snapshot) {
  const { baseRefName } = snapshot.pr;
  const { defaultBranch } = snapshot.repo;
  if (baseRefName === defaultBranch) {
    return makeFact('base', 'ok', `targets default branch ${baseRefName}`);
  }
  return makeFact('base', 'fail', `targets ${baseRefName}, default branch is ${defaultBranch}`);
}

/**
 * Whether the commits and checks that were collected belong to the PR's current head.
 *
 * @param {import('./snapshot.mjs').Snapshot} snapshot
 * @returns {Fact}
 */
export function headFact(snapshot) {
  const { commits, checks, pr } = snapshot;
  const lastCommit = commits.items.at(-1);
  const commitsMatch = lastCommit?.oid === pr.headRefOid;
  const checksMatch = checks.oid === null || checks.oid === pr.headRefOid;
  if (commitsMatch && checksMatch) {
    return makeFact('head', 'ok', `head ${short(pr.headRefOid)}`);
  }
  const parts = [`PR head ${short(pr.headRefOid)}`, `last commit ${short(lastCommit?.oid)}`];
  if (checks.oid !== null) {
    parts.push(`checks ${short(checks.oid)}`);
  }
  return makeFact('head', 'pending', `head moved (${parts.join(', ')})`);
}

/**
 * Lists the dependency updates declared by Dependabot's own commit, with from-versions taken
 * from the PR body and then the commit message. Empty when the metadata is missing or malformed.
 *
 * @param {import('./snapshot.mjs').Snapshot} snapshot
 * @returns {Bump[]} Sorted by name.
 */
export function bumpsOf(snapshot) {
  return readBumps(snapshot).bumps;
}

function readBumps(snapshot) {
  const message = snapshot.commits.items[0]?.message ?? '';
  const parsed = parseUpdatedDependencies(message);
  if (!parsed.ok) {
    return { ok: false, reason: parsed.reason, bumps: [] };
  }
  const fromMessage = parseFromVersions(message);
  const fromBody = parseFromVersions(snapshot.pr.body);
  const known = { ...fromMessage, ...fromBody };
  const toBump = (update) => ({
    name: update.name,
    from: Object.hasOwn(known, update.name) ? known[update.name] : null,
    to: update.version,
    dependencyType: update.dependencyType,
    updateType: update.updateType,
    effective: effectiveLevel(update.updateType, update.version),
    group: update.group,
  });
  const byNameThenVersion = (a, b) => compareStrings(a.name, b.name) || compareStrings(a.to, b.to);
  return { ok: true, reason: null, bumps: parsed.updates.map(toBump).sort(byNameThenVersion) };
}

function describeBump(bump) {
  const dependencyType = bump.dependencyType ?? '?';
  const updateType = bump.updateType ?? 'no update-type';
  const parts = [dependencyType, `${updateType} → ${bump.effective}`];
  if (bump.group) {
    parts.push(bump.group);
  }
  return `${bump.name} ${bump.from ?? '?'}→${bump.to} (${parts.join(', ')})`;
}

/**
 * Lists the bumps and whether they are all patch or minor. Major, unknown, or missing metadata
 * reports `info`, which the classifier routes to needs-analysis.
 *
 * @param {import('./snapshot.mjs').Snapshot} snapshot
 * @returns {Fact}
 */
export function bumpsFact(snapshot) {
  return factFromBumps(readBumps(snapshot));
}

function factFromBumps({ ok, reason, bumps }) {
  if (!ok) {
    return makeFact('bumps', 'info', `no updated-dependencies metadata (${reason})`);
  }
  const evidence = bumps.map(describeBump).join('; ');
  const routine = bumps.every((bump) => bump.effective === 'patch' || bump.effective === 'minor');
  return makeFact('bumps', routine ? 'ok' : 'info', evidence);
}

function normalizeCheck(check) {
  if (check.kind === 'StatusContext') {
    if (RUNNING_CHECK_STATES.has(check.conclusion)) {
      return 'running';
    }
    return check.conclusion === 'SUCCESS' ? 'success' : 'failing';
  }
  if (check.status !== 'COMPLETED') {
    return 'running';
  }
  if (check.conclusion === 'SUCCESS') {
    return 'success';
  }
  return check.conclusion === 'SKIPPED' || check.conclusion === 'NEUTRAL' ? 'neutral' : 'failing';
}

function byName(a, b) {
  return compareStrings(a.name, b.name);
}

function describeFailing(check) {
  return `${check.name} (${check.conclusion ?? 'unknown'})`;
}

/**
 * Summarizes the checks on the head commit.
 *
 * @param {import('./snapshot.mjs').Snapshot} snapshot
 * @returns {Fact}
 */
export function ciFact(snapshot) {
  const { items, totalCount } = snapshot.checks;
  if (items.length < totalCount) {
    return makeFact('ci', 'pending', `only ${items.length} of ${totalCount} checks fetched`);
  }
  if (items.length === 0) {
    return makeFact('ci', 'none', 'no checks reported');
  }
  const normalized = items.map((check) => ({ check, state: normalizeCheck(check) }));
  const withState = (state) => normalized.filter((entry) => entry.state === state).map((entry) => entry.check);
  const running = withState('running').sort(byName);
  const failing = withState('failing').sort(byName);
  const passed = withState('success').length;
  const skipped = withState('neutral').length;

  if (running.length > 0) {
    const parts = [`running: ${running.map((check) => check.name).join(', ')}`];
    if (failing.length > 0) {
      parts.push(`failing: ${failing.map(describeFailing).join(', ')}`);
    }
    return makeFact('ci', 'pending', parts.join('; '));
  }
  if (failing.length > 0) {
    return makeFact('ci', 'fail', `failing: ${failing.map(describeFailing).join(', ')}`);
  }
  if (passed === 0) {
    return makeFact('ci', 'none', `all ${items.length} checks skipped or neutral`);
  }
  const suffix = skipped > 0 ? `, ${skipped} skipped/neutral` : '';
  return makeFact('ci', 'ok', `${passed} passed${suffix}`);
}

/**
 * Reports GitHub's mergeability. A merge state of BLOCKED is informational because branch
 * protection routinely blocks a PR that is otherwise ready.
 *
 * @param {import('./snapshot.mjs').Snapshot} snapshot
 * @returns {Fact}
 */
export function mergeabilityFact(snapshot) {
  const { mergeable, mergeStateStatus: state } = snapshot.pr;
  const raw = `mergeable ${mergeable}, merge state ${state}`;
  if (mergeable === 'CONFLICTING' || state === 'DIRTY') {
    return makeFact('mergeability', 'fail', `merge conflicts (${raw})`);
  }
  if (mergeable === 'UNKNOWN' || state === 'UNKNOWN') {
    return makeFact('mergeability', 'pending', `GitHub has not computed mergeability yet (${raw})`);
  }
  if (state === 'BEHIND') {
    return makeFact('mergeability', 'pending', 'BEHIND: branch is behind the base branch');
  }
  if (Object.hasOwn(MERGE_STATE_NOTES, state)) {
    return makeFact('mergeability', 'info', MERGE_STATE_NOTES[state]);
  }
  if (state === 'CLEAN') {
    return makeFact('mergeability', 'ok', 'CLEAN: mergeable with no blocking requirements');
  }
  return makeFact('mergeability', 'info', raw);
}

function alertMatches(alerts, bumps) {
  if (!alerts?.available) {
    return [];
  }
  const reaches = (bump, alert) => {
    const order = compareVersions(bump.to, alert.patched);
    return order === 0 || order === 1;
  };
  const isFixed = (alert) => alert.patched !== null && bumps.some((bump) => bump.name === alert.package && reaches(bump, alert));
  return alerts.items.filter(isFixed).sort((x, y) => compareStrings(x.ghsa, y.ghsa));
}

function describeMatch(alert) {
  return `fixes ${alert.ghsa} (${alert.severity}) in ${alert.package}, patched in ${alert.patched}`;
}

function noSecuritySignal(alerts) {
  if (alerts === undefined) {
    return 'no security label; Dependabot alerts not checked';
  }
  if (!alerts.available) {
    return `no security label; Dependabot alerts unavailable (${alerts.reason})`;
  }
  return 'no open Dependabot alert fixed by this bump; no security label';
}

/**
 * Reports whether the PR fixes an open Dependabot alert (a bump to or past the alert's patched
 * version of the same package) or is labelled `security`.
 *
 * @param {import('./snapshot.mjs').Snapshot} snapshot
 * @param {AlertContext} [alerts]
 * @param {Bump[]} [bumps] The PR's bumps; read from the snapshot when omitted.
 * @returns {Fact}
 */
export function securityFact(snapshot, alerts, bumps = bumpsOf(snapshot)) {
  const signals = alertMatches(alerts, bumps).map(describeMatch);
  if (snapshot.pr.labels.some((label) => label.toLowerCase() === 'security')) {
    signals.push('labelled security');
  }
  if (signals.length > 0) {
    return makeFact('security', 'info', signals.join('; '));
  }
  return makeFact('security', 'none', noSecuritySignal(alerts));
}

function collectFacts(snapshot, bumpsRead, alerts) {
  return [
    authorFact(snapshot),
    provenanceFact(snapshot),
    draftFact(snapshot),
    baseFact(snapshot),
    headFact(snapshot),
    factFromBumps(bumpsRead),
    ciFact(snapshot),
    mergeabilityFact(snapshot),
    securityFact(snapshot, alerts, bumpsRead.bumps),
  ];
}

function factNamed(facts, name) {
  return facts.find((fact) => fact.fact === name);
}

function namesWithStatus(facts, names, statuses) {
  return names.filter((name) => statuses.includes(factNamed(facts, name).status));
}

function attentionAction(snapshot, failed) {
  if (failed.includes('author')) {
    return 'Not a Dependabot PR; review it manually';
  }
  if (failed.includes('provenance')) {
    return 'Inspect the non-bot commits before trusting this PR';
  }
  if (failed.includes('draft')) {
    return 'Draft PR; review once it is marked ready';
  }
  return `Targets ${snapshot.pr.baseRefName}, not the default branch; confirm this is intended`;
}

function waitingAction(snapshot, waiting) {
  if (waiting.includes('head')) {
    return 'Head moved during collection; re-run later';
  }
  if (snapshot.pr.mergeStateStatus === 'BEHIND') {
    return 'Dependabot will rebase; re-run later';
  }
  return 'Re-run later';
}

function blockedAction(facts) {
  if (factNamed(facts, 'mergeability').status === 'fail') {
    return 'Comment "@dependabot rebase" on the PR';
  }
  if (factNamed(facts, 'ci').status === 'fail') {
    return 'Investigate the failing CI';
  }
  return 'No passing CI; verify the change manually or add CI';
}

function decide(snapshot, facts) {
  const failed = namesWithStatus(facts, ['author', 'provenance', 'draft', 'base'], ['fail']);
  if (failed.length > 0) {
    return { bucket: 'attention', reasons: failed, suggestedAction: attentionAction(snapshot, failed), analyze: false };
  }
  const waiting = namesWithStatus(facts, ['head', 'ci', 'mergeability'], ['pending']);
  if (waiting.length > 0) {
    return { bucket: 'waiting', reasons: waiting, suggestedAction: waitingAction(snapshot, waiting), analyze: false };
  }
  const ci = factNamed(facts, 'ci');
  const blocked = [
    ...namesWithStatus(facts, ['ci'], ['fail', 'none']),
    ...namesWithStatus(facts, ['mergeability'], ['fail']),
  ];
  if (blocked.length > 0) {
    return {
      bucket: 'blocked',
      reasons: blocked,
      suggestedAction: blockedAction(facts),
      analyze: ci.status === 'fail',
    };
  }
  if (factNamed(facts, 'bumps').status === 'info') {
    return {
      bucket: 'needs-analysis',
      reasons: ['bumps'],
      suggestedAction: 'Read the impact analysis before deciding',
      analyze: true,
    };
  }
  return { bucket: 'routine', reasons: [], suggestedAction: 'Review the diff and merge', analyze: false };
}

/**
 * Sorts a PR into a review bucket from its facts.
 *
 * @param {import('./snapshot.mjs').Snapshot} snapshot
 * @param {ClassifyContext} [context]
 * @returns {Classification}
 */
export function classify(snapshot, context = {}) {
  const bumpsRead = readBumps(snapshot);
  const facts = collectFacts(snapshot, bumpsRead, context.alerts);
  const decision = decide(snapshot, facts);
  const { pr } = snapshot;
  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    sha: pr.headRefOid,
    ...decision,
    security: factNamed(facts, 'security').status === 'info',
    bumps: bumpsRead.bumps,
    facts,
  };
}

function compareClassifications(a, b) {
  const bucketOrder = BUCKETS.indexOf(a.bucket) - BUCKETS.indexOf(b.bucket);
  if (bucketOrder !== 0) {
    return bucketOrder;
  }
  if (a.security !== b.security) {
    return a.security ? -1 : 1;
  }
  return a.number - b.number || compareStrings(a.url, b.url);
}

/**
 * Classifies many PRs and orders them by bucket precedence, then security first, then PR number.
 * The result does not depend on the input order.
 *
 * @param {import('./snapshot.mjs').Snapshot[]} snapshots
 * @param {ClassifyContext} [context]
 * @returns {Classification[]}
 */
export function classifyAll(snapshots, context = {}) {
  return snapshots.map((snapshot) => classify(snapshot, context)).sort(compareClassifications);
}
