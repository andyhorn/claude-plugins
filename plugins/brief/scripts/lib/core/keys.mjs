/** Matches the Artifact URLs that brief accepts. */
export const ARTIFACT_URL = /^https:\/\/claude\.ai\/(code\/)?artifact\/[\w-]+$/;

const SCHEME_URL = /^(https?|ssh|git):\/\/([^/?#]+)\/(.+)$/i;
const SCP_URL = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/)(.+)$/;

function stripHostDecorations(authority) {
  const withoutUser = authority.slice(authority.lastIndexOf('@') + 1);
  const withoutPort = withoutUser.replace(/:\d*$/, '');
  return withoutPort.toLowerCase();
}

function repoFromParts(host, pathText) {
  const cleaned = pathText.replace(/[?#].*$/, '').replace(/\/+$/, '').replace(/\.git$/i, '');
  const segments = cleaned.split('/').filter((segment) => segment !== '');
  if (host === '' || segments.length < 2 || segments.some((segment) => segment === '.' || segment === '..')) {
    return null;
  }
  return { repo: `${host}/${segments.join('/')}`, repoName: segments[segments.length - 1] };
}

/**
 * Normalizes a git `origin` URL to a repo key. Userinfo (including tokens), the port, a trailing
 * slash and a `.git` suffix are dropped, and the host is lowercased.
 *
 * @param {string | null | undefined} url
 * @returns {{ repo: string, repoName: string } | null} `null` for local paths and unparseable input.
 */
export function repoKeyFromOrigin(url) {
  if (typeof url !== 'string') {
    return null;
  }
  const text = url.trim();
  const scheme = SCHEME_URL.exec(text);
  if (scheme) {
    return repoFromParts(stripHostDecorations(scheme[2]), scheme[3]);
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    return null;
  }
  const scp = SCP_URL.exec(text);
  return scp ? repoFromParts(scp[1].toLowerCase(), scp[2]) : null;
}

function trimTrailingSlashes(path) {
  return path.length > 1 ? path.replace(/\/+$/, '') || '/' : path;
}

function lastSegments(path) {
  return trimTrailingSlashes(path).split('/').filter((segment) => segment !== '');
}

function repoDirName(commonDir) {
  const segments = lastSegments(commonDir);
  const last = segments[segments.length - 1] ?? '';
  if (last === '.git') {
    return segments[segments.length - 2] ?? '';
  }
  return last.replace(/\.git$/, '');
}

/**
 * The repo key for a repository without a usable `origin`.
 *
 * @param {string} commonDir Absolute git common directory.
 * @param {(text: string) => string} sha1 Hex digest function.
 * @returns {{ repo: string, repoName: string }}
 */
export function localRepoKey(commonDir, sha1) {
  const repoName = repoDirName(commonDir);
  return { repo: `local/${repoName}-${sha1(commonDir).slice(0, 8)}`, repoName };
}

/**
 * Resolves the repo key from the origin URL when it parses, else from the common directory.
 *
 * @param {{ originUrl: string | null, commonDir: string, sha1: (text: string) => string }} input
 * @returns {{ repo: string, repoName: string }}
 */
export function resolveRepo({ originUrl, commonDir, sha1 }) {
  return repoKeyFromOrigin(originUrl) ?? localRepoKey(commonDir, sha1);
}

/**
 * Walks up from `path` to the nearest directory that contains `.git` (a directory or a file).
 *
 * @param {string} path Absolute path of a file or directory.
 * @param {(candidate: string) => boolean} exists Synchronous existence check.
 * @returns {string | null} The worktree root, or `null` when none is found or `path` is relative.
 */
export function findWorktreeRoot(path, exists) {
  if (typeof path !== 'string' || !path.startsWith('/')) {
    return null;
  }
  let current = trimTrailingSlashes(path);
  while (true) {
    const marker = current === '/' ? '/.git' : `${current}/.git`;
    if (exists(marker)) {
      return current;
    }
    if (current === '/') {
      return null;
    }
    const cut = current.lastIndexOf('/');
    current = cut <= 0 ? '/' : current.slice(0, cut);
  }
}

/**
 * The branch label shown in entries.
 *
 * @param {string | null | undefined} branch
 * @param {string | null | undefined} head
 * @returns {string | null}
 */
export function branchLabel(branch, head) {
  if (branch) {
    return branch;
  }
  return head ? `detached@${head.slice(0, 7)}` : null;
}

/**
 * @param {Date} date
 * @returns {string} ISO 8601 UTC without milliseconds, such as `2026-10-09T23:15:00Z`.
 */
export function isoSeconds(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * @param {Date} date
 * @param {string} rand Random suffix.
 * @returns {string} A doc id such as `20261009T231500Z-a1b2c3`.
 */
export function docIdFor(date, rand) {
  const stamp = isoSeconds(date).replace(/[-:]/g, '');
  return `${stamp}-${rand}`;
}
