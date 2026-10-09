#!/usr/bin/env node
import { readFile as readFileFromDisk } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { PARSE_OPTIONS, validateArgs } from './lib/core/args.mjs';
import { classifyAll } from './lib/core/classify.mjs';
import { buildCommentBody } from './lib/core/sanitize.mjs';
import { GitHubError, canWrite, createGitHub, defaultRunner, planComment } from './lib/io/github.mjs';

const USAGE = 'usage: triage.mjs collect [<pr>] | triage.mjs comment --pr <n> --body-file <file>';
const MIN_NODE_MAJOR = 22;
const FETCH_CONCURRENCY = 4;

const EXIT_BY_KIND = Object.freeze({
  auth: 3,
  repo: 4,
  archived: 5,
  permission: 7,
  gh: 1,
});

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

async function mapWithConcurrency(items, limit, task) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await task(items[index]);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

async function fetchOutcome(gh, repo, number) {
  try {
    return { number, snapshot: await gh.fetchSnapshot(repo, number) };
  } catch (error) {
    return { number, error: messageOf(error) };
  }
}

async function collect({ pr }, { gh, stdout, stderr, now }) {
  const repo = await gh.preflight();
  const numbers = pr === null ? await gh.listBotPrNumbers() : [pr];
  const outcomes = await mapWithConcurrency(numbers, FETCH_CONCURRENCY, (number) => fetchOutcome(gh, repo, number));
  const failed = outcomes.filter((outcome) => outcome.error !== undefined);
  if (pr !== null && failed.length > 0) {
    stderr.write(`triage: could not fetch PR #${pr}: ${failed[0].error}\n`);
    return 1;
  }
  const snapshots = outcomes.filter((outcome) => outcome.snapshot).map((outcome) => outcome.snapshot);
  const prs = classifyAll(snapshots);
  const result = {
    repo: repo.nameWithOwner,
    defaultBranch: repo.defaultBranch,
    viewer: snapshots[0]?.viewer ?? null,
    collectedAt: now().toISOString(),
    count: prs.length,
    prs,
  };
  if (failed.length > 0) {
    result.errors = failed.map(({ number, error }) => ({ number, error }));
  }
  stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return 0;
}

async function comment({ pr, bodyFile }, { gh, stdout, readFile }) {
  const repo = await gh.preflight();
  if (!canWrite(repo.viewerPermission)) {
    throw new GitHubError('permission', `posting a comment needs write access to ${repo.nameWithOwner}; your permission is ${repo.viewerPermission}`);
  }
  const text = await readFile(bodyFile, 'utf8');
  const body = buildCommentBody(text);
  const viewer = await gh.viewerLogin();
  const existingComments = await gh.listIssueComments(repo, pr);
  const plan = planComment({ existingComments, viewer, body });
  const written = plan.action === 'update'
    ? await gh.updateComment(repo, plan.commentId, plan.body)
    : await gh.createComment(repo, pr, plan.body);
  stdout.write(`${JSON.stringify({ action: plan.action, id: written.id, url: written.url }, null, 2)}\n`);
  return 0;
}

function parseCommandLine(argv) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, ...PARSE_OPTIONS });
  } catch (error) {
    return { ok: false, error: messageOf(error) };
  }
  return validateArgs(parsed);
}

/**
 * Runs the triage CLI. Exit codes: 0 ok, 1 unexpected, 2 usage, 3 gh missing or unauthenticated,
 * 4 repository unresolved, 5 repository archived, 6 Node older than 22, 7 insufficient permission
 * for `comment`.
 *
 * @param {string[]} argv Arguments after the script name.
 * @param {object} [deps]
 * @param {ReturnType<typeof createGitHub>} [deps.gh]
 * @param {{ write: (text: string) => unknown }} [deps.stdout]
 * @param {{ write: (text: string) => unknown }} [deps.stderr]
 * @param {(path: string, encoding: 'utf8') => Promise<string>} [deps.readFile]
 * @param {() => Date} [deps.now]
 * @param {string} [deps.nodeVersion]
 * @returns {Promise<number>} The process exit code.
 */
export async function main(argv, deps = {}) {
  const {
    gh = createGitHub({ run: defaultRunner }),
    stdout = process.stdout,
    stderr = process.stderr,
    readFile = readFileFromDisk,
    now = () => new Date(),
    nodeVersion = process.versions.node,
  } = deps;
  const major = Number(nodeVersion.split('.')[0]);
  if (major < MIN_NODE_MAJOR) {
    stderr.write(`triage: Node ${MIN_NODE_MAJOR} or newer is required; found ${nodeVersion}\n`);
    return 6;
  }
  const args = parseCommandLine(argv);
  if (!args.ok) {
    stderr.write(`triage: ${args.error}\n${USAGE}\n`);
    return 2;
  }
  try {
    const context = { gh, stdout, stderr, readFile, now };
    return args.command === 'collect' ? await collect(args, context) : await comment(args, context);
  } catch (error) {
    stderr.write(`triage: ${messageOf(error)}\n`);
    return error instanceof GitHubError ? EXIT_BY_KIND[error.kind] ?? 1 : 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main(process.argv.slice(2)));
}
