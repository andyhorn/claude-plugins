import { execFile } from 'node:child_process';

import { toPullRequest } from '../core/prs.mjs';

const MAX_BUFFER = 64 * 1024 * 1024;
const GH_TIMEOUT_MS = 30000;
const PR_FIELDS = 'number,state,mergedAt,headRefName,isCrossRepository,reviewDecision,statusCheckRollup';

/**
 * @typedef {object} RunResult
 * @property {number} code
 * @property {string} stdout
 * @property {string} stderr
 */

function exitCodeOf(error) {
  if (!error) {
    return 0;
  }
  return typeof error.code === 'number' ? error.code : 1;
}

/**
 * Runs `gh` with the given argv, without a shell. A call that outlives the timeout is killed and
 * reported as a failure.
 *
 * @param {string[]} args
 * @param {{ cwd?: string, timeoutMs?: number }} [opts]
 * @returns {Promise<RunResult>}
 */
export function defaultRunner(args, opts = {}) {
  return new Promise((resolve) => {
    const timeout = opts.timeoutMs ?? GH_TIMEOUT_MS;
    execFile('gh', args, { maxBuffer: MAX_BUFFER, cwd: opts.cwd, timeout }, (error, stdout, stderr) => {
      if (error && error.code === 'ENOENT') {
        resolve({ code: 127, stdout: '', stderr: 'gh: command not found' });
        return;
      }
      if (error && error.killed) {
        resolve({ code: 1, stdout: '', stderr: `gh: timed out after ${timeout / 1000}s` });
        return;
      }
      resolve({ code: exitCodeOf(error), stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

function failureOf(result) {
  if (result.code === 127) {
    return new Error('gh CLI not found; install it from https://cli.github.com');
  }
  const detail = result.stderr.trim() || result.stdout.trim() || `exit code ${result.code}`;
  return new Error(`gh pr list failed: ${detail}`);
}

/**
 * Creates the GitHub client.
 *
 * @param {{ run: (args: string[], opts: { cwd: string }) => Promise<RunResult> }} deps
 * @returns {{ listPullRequests: (cwd: string) => Promise<ReturnType<typeof toPullRequest>[]> }}
 */
export function createGitHub({ run }) {
  return {
    /**
     * Lists the repository's pull requests in any state.
     *
     * @param {string} cwd A directory inside the repository.
     * @throws {Error} When `gh` is missing, fails, or prints invalid JSON.
     */
    async listPullRequests(cwd) {
      const result = await run(['pr', 'list', '--state', 'all', '--limit', '200', '--json', PR_FIELDS], { cwd });
      if (result.code !== 0) {
        throw failureOf(result);
      }
      let parsed;
      try {
        parsed = JSON.parse(result.stdout);
      } catch {
        throw new Error('gh pr list returned invalid JSON');
      }
      if (!Array.isArray(parsed)) {
        throw new Error('gh pr list returned invalid JSON');
      }
      return parsed.map(toPullRequest);
    },
  };
}
