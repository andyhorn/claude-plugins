import { splitSegments } from './shell-segments.mjs';

/** The agent type the guard restricts. */
export const ANALYST_AGENT = 'deps:update-analyst';
const ANALYST_BARE_NAME = 'update-analyst';
const WRAPPER_WORDS = new Set(['env', 'command', 'exec', 'time', 'nohup', 'sudo', 'builtin']);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

const GH_SUMMARY = 'gh allows pr view/diff/checks/list/status, run view/list, release view/list, repo view, issue view/list, search, and api GET';
const GIT_SUMMARY = 'git allows fetch, ls-remote, grep, log, show, diff, remote (no args, -v, get-url, show), rev-parse, ls-files, cat-file, merge-base, blame, and status';
const FILTER_SUMMARY = 'other commands may only be the text filters cat, head, tail, wc, cut, tr, jq, grep, and sort (without -o), and output may only be redirected to /dev/null';

const TEXT_FILTERS = new Set(['cat', 'head', 'tail', 'wc', 'cut', 'tr', 'jq', 'grep', 'sort']);
const DEV_NULL = '/dev/null';
const FD_DUPLICATE_TARGET = /^(\d+|-)$/;
const FD_PREFIX = /^(\d*|&)$/;

const GH_READ_COMMANDS = {
  pr: ['view', 'diff', 'checks', 'list', 'status'],
  run: ['view', 'list'],
  release: ['view', 'list'],
  repo: ['view'],
  issue: ['view', 'list'],
};

const GH_API_VALUE_FLAGS = new Set(['X', 'f', 'F', 'H', 'q', 't', 'p']);
const GH_API_LONG_VALUE_FLAGS = new Set([
  'method', 'field', 'raw-field', 'header', 'input', 'jq', 'template', 'cache', 'hostname', 'preview',
]);
const GH_API_FIELD_FLAGS = new Set(['f', 'F', 'field', 'raw-field']);

const GIT_PLAIN_SUBCOMMANDS = new Set(['rev-parse', 'ls-files', 'cat-file', 'merge-base', 'blame', 'status']);
const GIT_GREP_VALUE_LETTERS = 'efABCm';

function allow() {
  return { decision: 'allow' };
}

function deny(reason) {
  return { decision: 'deny', reason };
}

function denyReadOnly(detail) {
  return deny(`${ANALYST_AGENT} is read-only: ${detail}. ${GH_SUMMARY}; ${GIT_SUMMARY}; ${FILTER_SUMMARY}`);
}

function basename(word) {
  return word.slice(word.lastIndexOf('/') + 1);
}

function stripLeadingWords(tokens) {
  let index = 0;
  while (index < tokens.length) {
    const { text, dynamic } = tokens[index];
    const isAssignment = !dynamic && ASSIGNMENT.test(text);
    const isWrapper = !dynamic && WRAPPER_WORDS.has(basename(text));
    if (!isAssignment && !isWrapper) {
      break;
    }
    index += 1;
  }
  return tokens.slice(index);
}

function isOpaqueCommandWord(token) {
  return token.dynamic || /[{*?]/.test(token.text) || (token.text.length > 1 && token.text.includes('['));
}

// A flag or value that starts with an expansion can carry any option, such as a write method, past a static check.
function startsWithExpansion(token) {
  return token.dynamic && (token.text.startsWith('$') || token.text.startsWith('-'));
}

function matchesLongOption(arg, name) {
  if (!arg.startsWith('--')) {
    return false;
  }
  const equals = arg.indexOf('=');
  const given = equals === -1 ? arg : arg.slice(0, equals);
  return given.length >= 3 && name.startsWith(given);
}

function takeValue(attached, args, index) {
  if (attached !== '') {
    return { value: attached, consumed: 0 };
  }
  return { value: args[index + 1] ?? '', consumed: 1 };
}

function recordApiFlag(parsed, name, value) {
  if (name === 'X' || name === 'method') {
    parsed.methods.push(value);
  } else if (GH_API_FIELD_FLAGS.has(name)) {
    parsed.fieldCount += 1;
  } else if (name === 'input') {
    parsed.hasInput = true;
  } else if ((name === 'H' || name === 'header') && /method-override/i.test(value)) {
    parsed.overrideHeader = true;
  }
}

function parseApiLong(parsed, args, index) {
  const arg = args[index];
  const equals = arg.indexOf('=');
  const name = equals === -1 ? arg.slice(2) : arg.slice(2, equals);
  if (!GH_API_LONG_VALUE_FLAGS.has(name)) {
    return 0;
  }
  const { value, consumed } = takeValue(equals === -1 ? '' : arg.slice(equals + 1), args, index);
  recordApiFlag(parsed, name, value);
  return consumed;
}

function parseApiShortCluster(parsed, args, index) {
  const arg = args[index];
  for (let i = 1; i < arg.length; i += 1) {
    const letter = arg[i];
    if (GH_API_VALUE_FLAGS.has(letter)) {
      const { value, consumed } = takeValue(arg.slice(i + 1), args, index);
      recordApiFlag(parsed, letter, value);
      return consumed;
    }
  }
  return 0;
}

function parseGhApi(args) {
  const parsed = { endpoint: null, methods: [], fieldCount: 0, hasInput: false, overrideHeader: false };
  let index = 0;
  while (index < args.length) {
    const arg = args[index];
    let consumed = 0;
    if (arg.startsWith('--')) {
      consumed = parseApiLong(parsed, args, index);
    } else if (arg.startsWith('-') && arg.length > 1) {
      consumed = parseApiShortCluster(parsed, args, index);
    } else if (parsed.endpoint === null) {
      parsed.endpoint = arg;
    }
    index += 1 + consumed;
  }
  return parsed;
}

function isGraphqlEndpoint(endpoint) {
  const path = endpoint.replace(/^https?:\/\/[^/]+/i, '').replace(/^\/+/, '').replace(/[?#].*$/, '');
  return path.toLowerCase() === 'graphql';
}

function checkGhApi(args) {
  const api = parseGhApi(args);
  if (api.endpoint === null) {
    return denyReadOnly('gh api needs an endpoint');
  }
  if (isGraphqlEndpoint(api.endpoint)) {
    return denyReadOnly('gh api graphql can run mutations');
  }
  if (api.hasInput) {
    return denyReadOnly('gh api --input sends a request body');
  }
  if (api.overrideHeader) {
    return denyReadOnly('gh api may not override the HTTP method with a header');
  }
  const nonGet = api.methods.filter((method) => method.toUpperCase() !== 'GET');
  if (nonGet.length > 0) {
    return denyReadOnly(`gh api method ${nonGet[0]} is a write`);
  }
  if (api.fieldCount > 0 && api.methods.length === 0) {
    return denyReadOnly('gh api fields imply a POST unless -X GET is given');
  }
  return allow();
}

function checkGh(args) {
  const [group, verb] = args.map((arg) => arg.text);
  if (group === 'search' && args.length > 1) {
    return allow();
  }
  if (group === 'api') {
    return checkGhApi(args.slice(1).map((arg) => arg.text));
  }
  if (Object.hasOwn(GH_READ_COMMANDS, group) && GH_READ_COMMANDS[group].includes(verb)) {
    return allow();
  }
  const attempted = ['gh', group, verb].filter(Boolean).join(' ');
  return denyReadOnly(`${attempted} is not allowed`);
}

function checkGitGlobalOptions(args) {
  let index = 0;
  while (index < args.length && args[index].startsWith('-')) {
    const arg = args[index];
    if (arg === '--no-pager' || arg === '-P') {
      index += 1;
    } else {
      return { error: `git option ${arg} is not allowed before the subcommand` };
    }
  }
  return { subcommand: args[index], rest: args.slice(index + 1) };
}

function checkGitFetchLike(subcommand, rest) {
  const forbidden = ['--upload-pack', '--exec', '--refmap'];
  const positionals = [];
  let optionsEnded = false;
  for (const arg of rest) {
    if (!optionsEnded && arg === '--') {
      optionsEnded = true;
    } else if (!optionsEnded && forbidden.some((name) => matchesLongOption(arg, name))) {
      return denyReadOnly(`git ${subcommand} ${arg} can run commands or rewrite refs`);
    } else if (optionsEnded || !arg.startsWith('-')) {
      positionals.push(arg);
    }
  }
  const refspecs = positionals.slice(1);
  const withDestination = refspecs.find((spec) => spec.includes(':'));
  if (withDestination) {
    return denyReadOnly(`git ${subcommand} refspec ${withDestination} could update local refs`);
  }
  return allow();
}

function checkGitGrep(rest) {
  for (const arg of rest) {
    if (arg === '--') {
      break;
    }
    if (matchesLongOption(arg, '--open-files-in-pager')) {
      return denyReadOnly('git grep --open-files-in-pager runs a program');
    }
    if (arg.startsWith('-') && !arg.startsWith('--')) {
      for (const letter of arg.slice(1)) {
        if (letter === 'O') {
          return denyReadOnly('git grep -O runs a program');
        }
        if (GIT_GREP_VALUE_LETTERS.includes(letter)) {
          break;
        }
      }
    }
  }
  return allow();
}

function checkGitDiffLike(subcommand, rest) {
  const forbidden = ['--output', '--ext-diff'];
  for (const arg of rest) {
    if (arg === '--') {
      break;
    }
    if (forbidden.some((name) => matchesLongOption(arg, name))) {
      return denyReadOnly(`git ${subcommand} ${arg} writes files or runs a program`);
    }
  }
  return allow();
}

function checkGitRemote(rest) {
  const [first] = rest;
  const listing = rest.length === 0 || (rest.length === 1 && (first === '-v' || first === '--verbose'));
  if (listing || first === 'get-url' || first === 'show') {
    return allow();
  }
  return denyReadOnly('git remote may only list remotes, get-url, or show');
}

function checkGit(args) {
  const options = checkGitGlobalOptions(args.map((arg) => arg.text));
  if (options.error) {
    return denyReadOnly(options.error);
  }
  const { subcommand, rest } = options;
  if (subcommand === 'fetch' || subcommand === 'ls-remote') {
    return checkGitFetchLike(subcommand, rest);
  }
  if (subcommand === 'grep') {
    return checkGitGrep(rest);
  }
  if (subcommand === 'log' || subcommand === 'show' || subcommand === 'diff') {
    return checkGitDiffLike(subcommand, rest);
  }
  if (subcommand === 'remote') {
    return checkGitRemote(rest);
  }
  if (GIT_PLAIN_SUBCOMMANDS.has(subcommand)) {
    return allow();
  }
  const attempted = subcommand === undefined ? 'git without a subcommand' : `git ${subcommand}`;
  return denyReadOnly(`${attempted} is not allowed`);
}

function mentionsGhOrGit(tokens) {
  return tokens.some(({ text }) => {
    const name = basename(text);
    return name === 'gh' || name === 'git' || text.includes('gh ') || text.includes('git ');
  });
}

function isSortOutputOption(arg) {
  if (matchesLongOption(arg, '--output')) {
    return true;
  }
  return arg.startsWith('-') && !arg.startsWith('--') && arg.includes('o');
}

function checkTextFilter(name, args) {
  if (name === 'sort' && args.some((arg) => isSortOutputOption(arg.text))) {
    return denyReadOnly('sort -o and --output write files');
  }
  return allow();
}

function parseRedirect(token) {
  const prefix = token.text.slice(0, token.redirectAt);
  const match = /^>(>?)(&?)(.*)$/s.exec(token.text.slice(token.redirectAt));
  const [, , duplicate, rest] = match;
  return { prefix, duplicate: duplicate === '&', rest };
}

function redirectIsAllowed({ duplicate, rest }, target) {
  if (duplicate) {
    return FD_DUPLICATE_TARGET.test(rest);
  }
  return target !== undefined && !target.dynamic && target.redirectAt === -1 && target.text === DEV_NULL;
}

function stripRedirects(tokens) {
  const remaining = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.redirectAt === -1) {
      remaining.push(token);
      continue;
    }
    const redirect = parseRedirect(token);
    const inline = redirect.rest !== '' && !redirect.duplicate;
    const target = inline ? { text: redirect.rest, dynamic: token.dynamic, redirectAt: -1 } : tokens[index + 1];
    if (!redirectIsAllowed(redirect, target)) {
      return { error: 'output redirection to anything but /dev/null or another file descriptor writes files' };
    }
    if (!inline && !redirect.duplicate) {
      index += 1;
    }
    if (!FD_PREFIX.test(redirect.prefix)) {
      remaining.push({ text: redirect.prefix, dynamic: token.dynamic, redirectAt: -1 });
    }
  }
  return { tokens: remaining };
}

function checkSegment(segment) {
  const redirects = stripRedirects(segment);
  if (redirects.error) {
    return denyReadOnly(redirects.error);
  }
  const tokens = stripLeadingWords(redirects.tokens);
  if (tokens.length === 0) {
    return allow();
  }
  const [commandWord, ...args] = tokens;
  if (isOpaqueCommandWord(commandWord)) {
    return denyReadOnly('a command name built from expansions or globs cannot be checked');
  }
  const name = basename(commandWord.text);
  if (name === 'gh' || name === 'git') {
    if (args.some(startsWithExpansion)) {
      return denyReadOnly(`${name} arguments that start with an expansion cannot be checked; write them out literally`);
    }
    return name === 'gh' ? checkGh(args) : checkGit(args);
  }
  if (!TEXT_FILTERS.has(commandWord.text)) {
    return denyReadOnly(`${commandWord.text} is not an allowed command`);
  }
  if (mentionsGhOrGit(tokens)) {
    return denyReadOnly('gh and git must be invoked directly, not through another command');
  }
  return checkTextFilter(commandWord.text, args);
}

/**
 * Decides whether a PreToolUse hook call may run. Only the `deps:update-analyst` agent is
 * restricted, and only for Bash. Its `gh` and `git` use is limited to an allowlist of read
 * commands, every other command must be a read-only text filter, and output redirection is
 * limited to /dev/null and file descriptor duplication; anything not on the list is denied.
 *
 * @param {{ agent_type?: string | null, tool_name?: string, tool_input?: { command?: string } }} hookInput Parsed PreToolUse hook JSON.
 * @returns {{ decision: 'allow' } | { decision: 'deny', reason: string }}
 */
export function evaluateGuard(hookInput) {
  const agentType = hookInput?.agent_type;
  const isAnalyst = agentType === ANALYST_AGENT || agentType === ANALYST_BARE_NAME;
  if (!isAnalyst || hookInput.tool_name !== 'Bash') {
    return allow();
  }
  const command = hookInput.tool_input?.command;
  if (typeof command !== 'string') {
    return denyReadOnly('the Bash command could not be read');
  }
  const segments = splitSegments(command);
  if (segments === null) {
    return denyReadOnly('the command has an unterminated quote or substitution and cannot be checked');
  }
  for (const segment of segments) {
    const verdict = checkSegment(segment);
    if (verdict.decision === 'deny') {
      return verdict;
    }
  }
  return allow();
}
