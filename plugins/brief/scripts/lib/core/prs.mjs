const FAILED_CONCLUSIONS = new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE']);
const FAILED_STATES = new Set(['FAILURE', 'ERROR']);
const PENDING_STATES = new Set(['PENDING', 'EXPECTED']);

function isStatusContext(node) {
  return node.__typename === 'StatusContext' || (node.__typename === undefined && node.state !== undefined);
}

function isFailed(node) {
  return isStatusContext(node) ? FAILED_STATES.has(node.state) : FAILED_CONCLUSIONS.has(node.conclusion);
}

function isPending(node) {
  return isStatusContext(node) ? PENDING_STATES.has(node.state) : node.status !== 'COMPLETED';
}

/**
 * Collapses a `statusCheckRollup` list into one word.
 *
 * @param {object[] | null | undefined} rollup
 * @returns {'failure' | 'pending' | 'success' | null} `null` when there are no checks.
 */
export function summarizeChecks(rollup) {
  if (!Array.isArray(rollup) || rollup.length === 0) {
    return null;
  }
  if (rollup.some(isFailed)) {
    return 'failure';
  }
  return rollup.some(isPending) ? 'pending' : 'success';
}

/**
 * Maps one pull request from `gh pr list --json` to the shape brief uses.
 *
 * @param {object} raw
 * @returns {{ number: number, state: string, mergedAt: string | null, headRefName: string, isCrossRepository: boolean, reviewDecision: string | null, ci: 'failure' | 'pending' | 'success' | null }}
 */
export function toPullRequest(raw) {
  return {
    number: raw.number,
    state: raw.state,
    mergedAt: raw.mergedAt ?? null,
    headRefName: raw.headRefName,
    isCrossRepository: raw.isCrossRepository === true,
    reviewDecision: raw.reviewDecision || null,
    ci: summarizeChecks(raw.statusCheckRollup),
  };
}

/**
 * Chooses the pull request that represents a branch: the open one if any, else the highest number.
 * Pull requests from forks are ignored, since their branch names are not this repo's.
 *
 * @param {{ number: number, state: string, headRefName: string, isCrossRepository?: boolean }[]} prs
 * @param {string | null | undefined} branch The raw branch name.
 * @returns {object | null}
 */
export function pickPr(prs, branch) {
  const matching = prs.filter((pr) => branch && pr.headRefName === branch && pr.isCrossRepository !== true);
  if (matching.length === 0) {
    return null;
  }
  const open = matching.filter((pr) => pr.state === 'OPEN');
  const pool = open.length > 0 ? open : matching;
  return pool.reduce((best, pr) => (pr.number > best.number ? pr : best));
}
