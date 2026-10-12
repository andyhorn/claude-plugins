import { execFile } from 'node:child_process';

import { MARKER } from '../core/sanitize.mjs';
import { CONTEXTS_PAGE_QUERY, SNAPSHOT_QUERY, toSnapshot } from '../core/snapshot.mjs';

const MAX_BUFFER = 64 * 1024 * 1024;
const WRITE_PERMISSIONS = new Set(['WRITE', 'MAINTAIN', 'ADMIN']);
const BOT_APPS = ['dependabot', 'renovate'];

/** An error from a `gh` call, tagged with the kind of failure. */
export class GitHubError extends Error {
  /**
   * @param {'auth' | 'repo' | 'archived' | 'permission' | 'gh'} kind
   * @param {string} message
   */
  constructor(kind, message) {
    super(message);
    this.name = 'GitHubError';
    this.kind = kind;
  }
}

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
 * Runs `gh` with the given argv, without a shell.
 *
 * @param {string[]} args
 * @param {{ input?: string }} [opts] Text written to stdin when given.
 * @returns {Promise<RunResult>}
 */
export function defaultRunner(args, opts = {}) {
  return new Promise((resolve) => {
    const child = execFile('gh', args, { maxBuffer: MAX_BUFFER }, (error, stdout, stderr) => {
      if (error && error.code === 'ENOENT') {
        resolve({ code: 127, stdout: '', stderr: 'gh: command not found' });
        return;
      }
      resolve({ code: exitCodeOf(error), stdout: String(stdout), stderr: String(stderr) });
    });
    if (opts.input !== undefined) {
      child.stdin.on('error', () => {});
      child.stdin.end(opts.input);
    }
  });
}

/**
 * Whether a `viewerPermission` value allows writing comments.
 *
 * @param {string | null | undefined} permission
 * @returns {boolean}
 */
export function canWrite(permission) {
  return WRITE_PERMISSIONS.has(permission);
}

/**
 * Chooses between creating a new triage comment and updating an existing one. Only a marker comment
 * written by the viewer is ever updated, so another user cannot redirect the write.
 *
 * @param {{ existingComments: { id: number, login: string | null, body: string }[], viewer: string, body: string }} input
 * @returns {{ action: 'create', body: string } | { action: 'update', commentId: number, body: string }}
 */
export function planComment({ existingComments, viewer, body }) {
  const owned = existingComments
    .filter((comment) => comment.login === viewer && String(comment.body ?? '').includes(MARKER))
    .sort((a, b) => a.id - b.id);
  if (owned.length === 0) {
    return { action: 'create', body };
  }
  return { action: 'update', commentId: owned[0].id, body };
}

function failure(result, what) {
  const detail = result.stderr.trim() || result.stdout.trim() || `exit code ${result.code}`;
  return new GitHubError('gh', `${what} failed: ${detail}`);
}

function parseJson(text, what) {
  try {
    return JSON.parse(text);
  } catch {
    throw new GitHubError('gh', `${what} returned invalid JSON`);
  }
}

function parseJsonLines(text, what) {
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => parseJson(line, what));
}

const ALERT_FIELDS = [
  'ghsa: .security_advisory.ghsa_id',
  'severity: .security_advisory.severity',
  'summary: .security_advisory.summary',
  'ecosystem: .security_vulnerability.package.ecosystem',
  'package: .security_vulnerability.package.name',
  'patched: .security_vulnerability.first_patched_version.identifier',
].join(', ');

function alertFailureReason(result) {
  const firstLine = result.stderr.split('\n').map((line) => line.trim()).find((line) => line !== '');
  const reason = (firstLine ?? '').replace(/^gh: /, '');
  return reason || `gh exited with code ${result.code}`;
}

function toAlert(entry) {
  return {
    ghsa: entry.ghsa,
    severity: entry.severity,
    summary: entry.summary,
    ecosystem: entry.ecosystem,
    package: entry.package,
    patched: entry.patched ?? null,
  };
}

function slug(repo) {
  return `${repo.owner}/${repo.name}`;
}

function contextsOf(data) {
  return data?.repository?.pullRequest?.headCommit?.nodes?.[0]?.commit?.statusCheckRollup?.contexts;
}

function nextContextsCursor(data) {
  const pageInfo = contextsOf(data)?.pageInfo;
  return pageInfo?.hasNextPage === true ? pageInfo.endCursor : null;
}

function appendContexts(data, page) {
  const target = contextsOf(data);
  const source = contextsOf(page);
  if (!source) {
    throw new GitHubError('gh', 'check context page was empty');
  }
  target.nodes.push(...source.nodes);
  target.pageInfo = source.pageInfo;
}

/**
 * @typedef {object} GitHubClient
 * @property {() => Promise<{ nameWithOwner: string, owner: string, name: string, defaultBranch: string | null, viewerPermission: string }>} preflight
 * @property {() => Promise<number[]>} listBotPrNumbers
 * @property {(repo: { owner: string, name: string }, number: number) => Promise<import('../core/snapshot.mjs').Snapshot>} fetchSnapshot
 * @property {(repo: { owner: string, name: string }) => Promise<import('../core/classify.mjs').AlertContext>} listOpenAlerts
 * @property {(repo: { owner: string, name: string }, number: number) => Promise<{ id: number, login: string | null, body: string }[]>} listIssueComments
 * @property {(repo: { owner: string, name: string }, number: number, body: string) => Promise<{ id: number, url: string }>} createComment
 * @property {(repo: { owner: string, name: string }, commentId: number, body: string) => Promise<{ id: number, url: string }>} updateComment
 * @property {() => Promise<string>} viewerLogin
 */

/**
 * Creates the GitHub client.
 *
 * @param {{ run: (args: string[], opts?: { input?: string }) => Promise<RunResult> }} deps
 * @returns {GitHubClient}
 */
export function createGitHub({ run }) {
  async function graphql(query, variables) {
    const args = ['api', 'graphql', '-f', `query=${query}`];
    for (const [key, value] of Object.entries(variables)) {
      args.push(typeof value === 'number' ? '-F' : '-f', `${key}=${value}`);
    }
    const result = await run(args);
    if (result.code !== 0) {
      throw failure(result, 'gh api graphql');
    }
    const parsed = parseJson(result.stdout, 'gh api graphql');
    if (parsed.errors?.length && !parsed.data) {
      throw new GitHubError('gh', `gh api graphql failed: ${parsed.errors.map((e) => e.message).join('; ')}`);
    }
    return parsed.data;
  }

  async function sendComment(args, body, what) {
    const result = await run(args, { input: JSON.stringify({ body }) });
    if (result.code !== 0) {
      throw failure(result, what);
    }
    const parsed = parseJson(result.stdout, what);
    return { id: parsed.id, url: parsed.html_url };
  }

  return {
    /**
     * Checks that `gh` is installed and authenticated and that the repository is usable.
     *
     * @returns {Promise<{ nameWithOwner: string, owner: string, name: string, defaultBranch: string | null, viewerPermission: string }>}
     * @throws {GitHubError} With kind `auth`, `repo`, or `archived`.
     */
    async preflight() {
      const auth = await run(['auth', 'status']);
      if (auth.code === 127) {
        throw new GitHubError('auth', 'gh CLI not found; install it from https://cli.github.com');
      }
      if (auth.code !== 0) {
        throw new GitHubError('auth', 'gh is not authenticated; run `gh auth login`');
      }
      const view = await run(['repo', 'view', '--json', 'nameWithOwner,isArchived,defaultBranchRef,viewerPermission']);
      if (view.code !== 0) {
        const stderr = view.stderr.trim();
        const detail = stderr ? ` (${stderr})` : '';
        throw new GitHubError('repo', `could not resolve the repository${detail}; run from a clone of the target repo or use \`gh repo set-default\``);
      }
      const info = parseJson(view.stdout, 'gh repo view');
      if (info.isArchived === true) {
        throw new GitHubError('archived', `${info.nameWithOwner} is archived`);
      }
      const [owner, name] = info.nameWithOwner.split('/');
      return {
        nameWithOwner: info.nameWithOwner,
        owner,
        name,
        defaultBranch: info.defaultBranchRef?.name ?? null,
        viewerPermission: info.viewerPermission,
      };
    },

    /**
     * Lists open Dependabot and Renovate PR numbers.
     *
     * @returns {Promise<number[]>} Deduplicated, ascending.
     */
    async listBotPrNumbers() {
      const numbers = new Set();
      for (const app of BOT_APPS) {
        const result = await run(['pr', 'list', '--state', 'open', '--app', app, '--limit', '1000', '--json', 'number']);
        if (result.code !== 0) {
          throw failure(result, `gh pr list --app ${app}`);
        }
        for (const entry of parseJson(result.stdout, 'gh pr list')) {
          numbers.add(entry.number);
        }
      }
      return [...numbers].sort((a, b) => a - b);
    },

    /**
     * Fetches one PR with every page of its head-commit checks.
     *
     * @param {{ owner: string, name: string }} repo
     * @param {number} number
     * @returns {Promise<import('../core/snapshot.mjs').Snapshot>}
     */
    async fetchSnapshot(repo, number) {
      const variables = { owner: repo.owner, name: repo.name, number };
      const data = await graphql(SNAPSHOT_QUERY, variables);
      let cursor = nextContextsCursor(data);
      while (cursor !== null) {
        const page = await graphql(CONTEXTS_PAGE_QUERY, { ...variables, cursor });
        appendContexts(data, page);
        cursor = nextContextsCursor(data);
      }
      return toSnapshot(data);
    },

    /**
     * Lists the repository's open Dependabot alerts. Never throws: when the alerts cannot be read
     * (disabled, or a token without access), the result says so and carries the reason.
     *
     * @param {{ owner: string, name: string }} repo
     * @returns {Promise<import('../core/classify.mjs').AlertContext>}
     */
    async listOpenAlerts(repo) {
      const path = `repos/${slug(repo)}/dependabot/alerts?state=open&per_page=100`;
      try {
        const result = await run(['api', '--paginate', path, '--jq', `.[] | {${ALERT_FIELDS}}`]);
        if (result.code !== 0) {
          return { available: false, reason: alertFailureReason(result) };
        }
        return { available: true, items: parseJsonLines(result.stdout, 'listing Dependabot alerts').map(toAlert) };
      } catch (error) {
        return { available: false, reason: error instanceof Error ? error.message : String(error) };
      }
    },

    /**
     * Lists every comment on an issue or pull request.
     *
     * @param {{ owner: string, name: string }} repo
     * @param {number} number
     * @returns {Promise<{ id: number, login: string | null, body: string }[]>}
     */
    async listIssueComments(repo, number) {
      const path = `repos/${slug(repo)}/issues/${number}/comments`;
      const result = await run(['api', '--paginate', path, '--jq', '.[] | {id, login: .user.login, body}']);
      if (result.code !== 0) {
        throw failure(result, 'listing comments');
      }
      return parseJsonLines(result.stdout, 'listing comments');
    },

    /**
     * Posts a new comment.
     *
     * @param {{ owner: string, name: string }} repo
     * @param {number} number
     * @param {string} body
     * @returns {Promise<{ id: number, url: string }>}
     */
    createComment(repo, number, body) {
      const path = `repos/${slug(repo)}/issues/${number}/comments`;
      return sendComment(['api', '--method', 'POST', path, '--input', '-'], body, 'creating the comment');
    },

    /**
     * Replaces the body of an existing comment.
     *
     * @param {{ owner: string, name: string }} repo
     * @param {number} commentId
     * @param {string} body
     * @returns {Promise<{ id: number, url: string }>}
     */
    updateComment(repo, commentId, body) {
      const path = `repos/${slug(repo)}/issues/comments/${commentId}`;
      return sendComment(['api', '--method', 'PATCH', path, '--input', '-'], body, 'updating the comment');
    },

    /**
     * Returns the login of the authenticated user.
     *
     * @returns {Promise<string>}
     */
    async viewerLogin() {
      const result = await run(['api', 'user', '--jq', '.login']);
      if (result.code !== 0) {
        throw failure(result, 'gh api user');
      }
      return result.stdout.trim();
    },
  };
}
