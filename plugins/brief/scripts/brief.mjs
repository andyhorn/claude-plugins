#!/usr/bin/env node
import { existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { PARSE_OPTIONS, validateArgs } from './lib/core/args.mjs';
import { branchLabel, docIdFor, isoSeconds, resolveRepo } from './lib/core/keys.mjs';
import { pickPr } from './lib/core/prs.mjs';
import { planTidy } from './lib/core/tidy.mjs';
import { readSavedEntries } from './lib/io/entries.mjs';
import { createEnv } from './lib/io/env.mjs';
import { listWorktrees, repoFacts, worktreeStatus } from './lib/io/git.mjs';
import { createGitHub, defaultRunner } from './lib/io/github.mjs';
import { readState, writeState } from './lib/io/store.mjs';

const USAGE = [
  'usage: brief.mjs state --data <dir> [--set-url <url> --page-version <n>]',
  '       brief.mjs context --data <dir> [--cwd <dir>]',
  '       brief.mjs worktrees --data <dir> [--pr]',
  '       brief.mjs tidy --data <dir> --entries <dir>',
].join('\n');
const MIN_NODE_MAJOR = 22;

function worktreeExists(path) {
  return existsSync(join(path, '.git'));
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function printJson(stdout, value) {
  stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function fail(stderr, code, message) {
  stderr.write(`brief: ${message}\n`);
  return code;
}

function notSetUp(stderr) {
  return fail(stderr, 4, 'brief is not set up; run /brief');
}

function notInGit(stderr) {
  return fail(stderr, 3, 'not in a git worktree');
}

async function state(args, { store, stdout, stderr }) {
  if (args.set) {
    await store.writeState(args.data, args.set);
    printJson(stdout, { url: args.set.url, pageVersion: args.set.pageVersion });
    return 0;
  }
  const saved = await store.readState(args.data);
  if (saved === null) {
    return notSetUp(stderr);
  }
  printJson(stdout, { url: saved.url, pageVersion: saved.pageVersion });
  return 0;
}

async function context(args, { git, env, store, cwd, stdout, stderr }) {
  const saved = await store.readState(args.data);
  if (saved === null) {
    return notSetUp(stderr);
  }
  const facts = await git.repoFacts(args.cwd ?? cwd);
  if (facts === null) {
    return notInGit(stderr);
  }
  const { repo, repoName } = resolveRepo({ originUrl: facts.originUrl, commonDir: facts.commonDir, sha1: env.sha1 });
  const now = env.now();
  printJson(stdout, {
    url: saved.url,
    repo,
    repoName,
    host: env.hostname(),
    worktree: facts.worktree,
    branch: branchLabel(facts.branch, facts.head),
    head: facts.head,
    ts: isoSeconds(now),
    docId: docIdFor(now, env.newId()),
  });
  return 0;
}

async function requireWorktrees(git, directory) {
  const worktrees = await git.listWorktrees(directory);
  if (worktrees === null) {
    throw new Error('could not list git worktrees');
  }
  return worktrees;
}

async function collectPullRequests(gh, directory) {
  try {
    return { prs: await gh.listPullRequests(directory), prError: null };
  } catch (error) {
    return { prs: [], prError: messageOf(error) };
  }
}

function toRow(worktree, status) {
  return {
    path: worktree.path,
    branch: worktree.bare ? null : branchLabel(worktree.branch, worktree.head),
    head: worktree.head,
    isMain: worktree.isMain,
    prunable: worktree.prunable,
    ahead: status.ahead,
    behind: status.behind,
    dirtyCount: status.dirtyCount,
  };
}

function prSummary(prs, branch) {
  const pr = pickPr(prs, branch);
  return pr === null ? null : { number: pr.number, state: pr.state, mergedAt: pr.mergedAt, ci: pr.ci, reviewDecision: pr.reviewDecision };
}

async function statusOf(git, worktree) {
  if (worktree.bare) {
    return { ahead: null, behind: null, dirtyCount: null };
  }
  return git.worktreeStatus(worktree.path);
}

async function worktrees(args, { git, gh, cwd, stdout, stderr }) {
  const facts = await git.repoFacts(cwd);
  if (facts === null) {
    return notInGit(stderr);
  }
  const listed = await requireWorktrees(git, cwd);
  const statuses = await Promise.all(listed.map((worktree) => statusOf(git, worktree)));
  const rows = listed.map((worktree, index) => toRow(worktree, statuses[index]));
  if (!args.pr) {
    printJson(stdout, { worktrees: rows });
    return 0;
  }
  const { prs, prError } = await collectPullRequests(gh, facts.worktree);
  if (prError !== null) {
    printJson(stdout, { worktrees: rows, prError });
    return 0;
  }
  const withPrs = rows.map((row, index) => ({ ...row, pr: prSummary(prs, listed[index].branch) }));
  printJson(stdout, { worktrees: withPrs });
  return 0;
}

async function tidy(args, { git, gh, env, readEntries, exists, cwd, stdout, stderr }) {
  const facts = await git.repoFacts(cwd);
  if (facts === null) {
    return notInGit(stderr);
  }
  const listed = await requireWorktrees(git, cwd);
  const { prs, prError } = await collectPullRequests(gh, facts.worktree);
  const { entries, unreadable } = await readEntries(args.entries);
  const { repo } = resolveRepo({ originUrl: facts.originUrl, commonDir: facts.commonDir, sha1: env.sha1 });
  const plan = planTidy({ entries, worktrees: listed, prs, repo, host: env.hostname(), now: env.now(), newId: env.newId, exists });
  const result = { archive: plan.archive, prune: plan.prune, skipped: plan.skipped + unreadable };
  printJson(stdout, prError === null ? result : { ...result, prError });
  return 0;
}

const COMMAND_HANDLERS = Object.freeze({ state, context, worktrees, tidy });

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
 * Runs the brief CLI. Exit codes: 0 ok, 1 unexpected, 2 usage, 3 not inside a git worktree,
 * 4 brief is not set up, 6 Node older than 22.
 *
 * @param {string[]} argv Arguments after the script name.
 * @param {object} [deps]
 * @param {{ repoFacts: typeof repoFacts, listWorktrees: typeof listWorktrees, worktreeStatus: typeof worktreeStatus }} [deps.git]
 * @param {ReturnType<typeof createGitHub>} [deps.gh]
 * @param {ReturnType<typeof createEnv>} [deps.env]
 * @param {{ readState: typeof readState, writeState: typeof writeState }} [deps.store]
 * @param {typeof readSavedEntries} [deps.readEntries]
 * @param {(path: string) => boolean} [deps.exists] Whether a worktree path still holds a checkout.
 * @param {string} [deps.cwd]
 * @param {{ write: (text: string) => unknown }} [deps.stdout]
 * @param {{ write: (text: string) => unknown }} [deps.stderr]
 * @param {string} [deps.nodeVersion]
 * @returns {Promise<number>} The process exit code.
 */
export async function main(argv, deps = {}) {
  const {
    git = { repoFacts, listWorktrees, worktreeStatus },
    gh = createGitHub({ run: defaultRunner }),
    env = createEnv(),
    store = { readState, writeState },
    readEntries = readSavedEntries,
    exists = worktreeExists,
    cwd = process.cwd(),
    stdout = process.stdout,
    stderr = process.stderr,
    nodeVersion = process.versions.node,
  } = deps;
  const major = Number(nodeVersion.split('.')[0]);
  if (major < MIN_NODE_MAJOR) {
    return fail(stderr, 6, `Node ${MIN_NODE_MAJOR} or newer is required; found ${nodeVersion}`);
  }
  const args = parseCommandLine(argv);
  if (!args.ok) {
    stderr.write(`brief: ${args.error}\n${USAGE}\n`);
    return 2;
  }
  try {
    return await COMMAND_HANDLERS[args.command](args, { git, gh, env, store, readEntries, exists, cwd, stdout, stderr });
  } catch (error) {
    return fail(stderr, 1, messageOf(error));
  }
}

function isEntrypoint() {
  const script = process.argv[1];
  if (!script) {
    return false;
  }
  try {
    return import.meta.url === pathToFileURL(realpathSync(script)).href;
  } catch {
    return import.meta.url === pathToFileURL(script).href;
  }
}

if (isEntrypoint()) {
  process.exit(await main(process.argv.slice(2)));
}
