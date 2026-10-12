import { execFile } from 'node:child_process';

const GIT_TIMEOUT_MS = 2000;
const MAX_BUFFER = 16 * 1024 * 1024;
const NULL_SHA = /^0+$/;
const RENAME_OR_COPY = /^(?:[RC]|.[RC])/;

function runGit(args, cwd) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: MAX_BUFFER, encoding: 'utf8' }, (error, stdout) => {
      resolve(error ? null : String(stdout));
    });
  });
}

function firstLine(text) {
  if (text === null) {
    return null;
  }
  const line = text.replace(/\r?\n$/, '');
  return line === '' ? null : line;
}

function branchName(symbolicRef) {
  const ref = firstLine(symbolicRef);
  return ref === null ? null : ref.replace(/^refs\/heads\//, '');
}

/**
 * Reads the git facts for a directory.
 *
 * @param {string} cwd
 * @returns {Promise<{ worktree: string, commonDir: string, originUrl: string | null, branch: string | null, head: string | null } | null>}
 *   `null` when the directory is not inside a git worktree.
 */
export async function repoFacts(cwd) {
  const [toplevel, commonDir, branch, head, origin] = await Promise.all([
    runGit(['rev-parse', '--show-toplevel'], cwd),
    runGit(['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd),
    runGit(['symbolic-ref', '-q', 'HEAD'], cwd),
    runGit(['rev-parse', '-q', '--verify', 'HEAD'], cwd),
    runGit(['remote', 'get-url', 'origin'], cwd),
  ]);
  const worktree = firstLine(toplevel);
  const common = firstLine(commonDir);
  if (worktree === null || common === null) {
    return null;
  }
  return { worktree, commonDir: common, originUrl: firstLine(origin), branch: branchName(branch), head: firstLine(head) };
}

function parseRecord(fields) {
  const row = { path: '', head: null, branch: null, bare: false, prunable: false };
  for (const field of fields) {
    if (field.startsWith('worktree ')) {
      row.path = field.slice('worktree '.length);
    } else if (field.startsWith('HEAD ')) {
      const sha = field.slice('HEAD '.length);
      row.head = NULL_SHA.test(sha) ? null : sha;
    } else if (field.startsWith('branch ')) {
      row.branch = field.slice('branch '.length).replace(/^refs\/heads\//, '');
    } else if (field === 'bare') {
      row.bare = true;
    } else if (field === 'prunable' || field.startsWith('prunable ')) {
      row.prunable = true;
    }
  }
  return row;
}

/**
 * Parses the output of `git worktree list --porcelain -z`.
 *
 * @param {string} text
 * @returns {{ path: string, head: string | null, branch: string | null, bare: boolean, prunable: boolean, isMain: boolean }[]}
 */
export function parseWorktreeList(text) {
  const records = [];
  let fields = [];
  for (const field of text.split('\0')) {
    if (field === '') {
      if (fields.length > 0) {
        records.push(fields);
      }
      fields = [];
    } else {
      fields.push(field);
    }
  }
  if (fields.length > 0) {
    records.push(fields);
  }
  return records
    .map(parseRecord)
    .filter((row) => row.path !== '')
    .map((row, index) => ({ ...row, isMain: index === 0 }));
}

/**
 * Lists the worktrees of the repository containing `cwd`.
 *
 * @param {string} cwd
 * @returns {Promise<ReturnType<typeof parseWorktreeList> | null>} `null` when git could not list them.
 */
export async function listWorktrees(cwd) {
  const output = await runGit(['worktree', 'list', '--porcelain', '-z'], cwd);
  return output === null ? null : parseWorktreeList(output);
}

/**
 * Counts the entries in `git status --porcelain -z` output. A rename or copy record is followed by
 * a second field holding the original path, which is not a separate entry.
 *
 * @param {string} text
 * @returns {number}
 */
export function countStatusRecords(text) {
  const fields = text.split('\0');
  let count = 0;
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    if (field === '') {
      continue;
    }
    count += 1;
    if (RENAME_OR_COPY.test(field)) {
      index += 1;
    }
  }
  return count;
}

function parseAheadBehind(output) {
  const match = output === null ? null : /^(\d+)\s+(\d+)\s*$/.exec(output);
  return match ? { behind: Number(match[1]), ahead: Number(match[2]) } : { ahead: null, behind: null };
}

/**
 * Reads how far a worktree is from its upstream and how many paths are dirty.
 *
 * @param {string} path
 * @returns {Promise<{ ahead: number | null, behind: number | null, dirtyCount: number | null }>}
 */
export async function worktreeStatus(path) {
  const [counts, status] = await Promise.all([
    runGit(['rev-list', '--left-right', '--count', '@{upstream}...HEAD'], path),
    runGit(['--no-optional-locks', 'status', '--porcelain', '-z', '--untracked-files=all'], path),
  ]);
  return { ...parseAheadBehind(counts), dirtyCount: status === null ? null : countStatusRecords(status) };
}
