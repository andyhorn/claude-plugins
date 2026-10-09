const ANALYST_AGENT = 'deps:update-analyst';
const WRAPPER_WORDS = new Set(['env', 'command', 'exec', 'time', 'nohup', 'sudo', 'builtin']);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

const GH_SUMMARY = 'gh allows pr view/diff/checks/list/status, run view/list, release view/list, repo view, issue view/list, search, and api GET';
const GIT_SUMMARY = 'git allows fetch, ls-remote, grep, log, show, diff, remote (no args, -v, get-url, show), rev-parse, ls-files, cat-file, merge-base, blame, and status';

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

function basename(word) {
  return word.slice(word.lastIndexOf('/') + 1);
}

/**
 * Splits a shell command into simple-command segments. Command substitutions become their own
 * segments, including those inside double quotes. Returns null when a quote or substitution is
 * left open, because such a command cannot be analyzed.
 */
function splitSegments(command) {
  const segments = [];
  let pos = 0;

  function parseList(closer) {
    let tokens = [];
    let text = '';
    let dynamic = false;
    let inToken = false;

    function endToken() {
      if (inToken) {
        tokens.push({ text, dynamic });
      }
      text = '';
      dynamic = false;
      inToken = false;
    }

    function endSegment() {
      endToken();
      if (tokens.length > 0) {
        segments.push(tokens);
      }
      tokens = [];
    }

    function append(char) {
      text += char;
      inToken = true;
    }

    function substitute(substitutionCloser) {
      append('$');
      dynamic = true;
      return parseList(substitutionCloser);
    }

    function parseDoubleQuoted() {
      inToken = true;
      while (pos < command.length) {
        const char = command[pos];
        const next = command[pos + 1];
        if (char === '"') {
          pos += 1;
          return true;
        }
        if (char === '\\' && next !== undefined && '"\\$`'.includes(next)) {
          append(next);
          pos += 2;
        } else if (char === '$' && next === '(') {
          pos += 2;
          if (!substitute(')')) {
            return false;
          }
        } else if (char === '`') {
          pos += 1;
          if (!substitute('`')) {
            return false;
          }
        } else {
          if (char === '$') {
            dynamic = true;
          }
          append(char);
          pos += 1;
        }
      }
      return false;
    }

    function parseSingleQuoted() {
      inToken = true;
      const end = command.indexOf("'", pos);
      if (end === -1) {
        return false;
      }
      text += command.slice(pos, end);
      pos = end + 1;
      return true;
    }

    while (pos < command.length) {
      const char = command[pos];
      const next = command[pos + 1];
      if (char === closer) {
        pos += 1;
        endSegment();
        return true;
      }
      if (char === ' ' || char === '\t' || char === '\r') {
        endToken();
        pos += 1;
      } else if (char === '\n' || char === ';' || char === '|' || char === ')') {
        endSegment();
        pos += 1;
      } else if (char === '&') {
        const redirect = inToken && /[<>]$/.test(text);
        if (redirect || next === '>') {
          append(char);
        } else {
          endSegment();
        }
        pos += 1;
      } else if (char === '(') {
        endSegment();
        pos += 1;
        if (!parseList(')')) {
          return false;
        }
      } else if (char === '$' && next === '(') {
        pos += 2;
        if (!substitute(')')) {
          return false;
        }
      } else if (char === '`') {
        pos += 1;
        if (!substitute('`')) {
          return false;
        }
      } else if (char === '"') {
        pos += 1;
        if (!parseDoubleQuoted()) {
          return false;
        }
      } else if (char === "'") {
        pos += 1;
        if (!parseSingleQuoted()) {
          return false;
        }
      } else if (char === '\\') {
        if (next === '\n') {
          pos += 2;
        } else if (next === undefined) {
          pos += 1;
        } else {
          append(next);
          pos += 2;
        }
      } else {
        if (char === '$') {
          dynamic = true;
        }
        append(char);
        pos += 1;
      }
    }
    endSegment();
    return closer === null;
  }

  return parseList(null) ? segments : null;
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

function denyGh(detail) {
  return deny(`deps:update-analyst is read-only: ${detail}. ${GH_SUMMARY}`);
}

function denyGit(detail) {
  return deny(`deps:update-analyst is read-only: ${detail}. ${GIT_SUMMARY}`);
}

function parseGhApi(args) {
  const parsed = { endpoint: null, methods: [], fieldCount: 0, hasInput: false, overrideHeader: false };
  let index = 0;

  function takeValue(attached) {
    if (attached !== '') {
      return attached;
    }
    index += 1;
    return args[index] ?? '';
  }

  function record(name, value) {
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

  function parseLong(arg) {
    const equals = arg.indexOf('=');
    const name = equals === -1 ? arg.slice(2) : arg.slice(2, equals);
    if (!GH_API_LONG_VALUE_FLAGS.has(name)) {
      return;
    }
    record(name, takeValue(equals === -1 ? '' : arg.slice(equals + 1)));
  }

  function parseShortCluster(arg) {
    for (let i = 1; i < arg.length; i += 1) {
      const letter = arg[i];
      if (GH_API_VALUE_FLAGS.has(letter)) {
        record(letter, takeValue(arg.slice(i + 1)));
        return;
      }
    }
  }

  for (; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith('--')) {
      parseLong(arg);
    } else if (arg.startsWith('-') && arg.length > 1) {
      parseShortCluster(arg);
    } else if (parsed.endpoint === null) {
      parsed.endpoint = arg;
    }
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
    return denyGh('gh api needs an endpoint');
  }
  if (isGraphqlEndpoint(api.endpoint)) {
    return denyGh('gh api graphql can run mutations');
  }
  if (api.hasInput) {
    return denyGh('gh api --input sends a request body');
  }
  if (api.overrideHeader) {
    return denyGh('gh api may not override the HTTP method with a header');
  }
  const nonGet = api.methods.filter((method) => method.toUpperCase() !== 'GET');
  if (nonGet.length > 0) {
    return denyGh(`gh api method ${nonGet[0]} is a write`);
  }
  if (api.fieldCount > 0 && api.methods.length === 0) {
    return denyGh('gh api fields imply a POST unless -X GET is given');
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
  return denyGh(`${attempted} is not allowed`);
}

function checkGitGlobalOptions(args) {
  let index = 0;
  while (index < args.length && args[index].startsWith('-')) {
    const arg = args[index];
    if (arg === '-C') {
      index += 2;
    } else if (arg === '--no-pager' || arg === '-P' || arg.startsWith('--git-dir=') || arg.startsWith('--work-tree=')) {
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
      return denyGit(`git ${subcommand} ${arg} can run commands or rewrite refs`);
    } else if (optionsEnded || !arg.startsWith('-')) {
      positionals.push(arg);
    }
  }
  const refspecs = positionals.slice(1);
  const withDestination = refspecs.find((spec) => spec.includes(':'));
  if (withDestination) {
    return denyGit(`git ${subcommand} refspec ${withDestination} could update local refs`);
  }
  return allow();
}

function checkGitGrep(rest) {
  for (const arg of rest) {
    if (arg === '--') {
      break;
    }
    if (matchesLongOption(arg, '--open-files-in-pager')) {
      return denyGit('git grep --open-files-in-pager runs a program');
    }
    if (arg.startsWith('-') && !arg.startsWith('--')) {
      for (const letter of arg.slice(1)) {
        if (letter === 'O') {
          return denyGit('git grep -O runs a program');
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
      return denyGit(`git ${subcommand} ${arg} writes files or runs a program`);
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
  return denyGit('git remote may only list remotes, get-url, or show');
}

function checkGit(args) {
  const options = checkGitGlobalOptions(args.map((arg) => arg.text));
  if (options.error) {
    return denyGit(options.error);
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
  return denyGit(`${attempted} is not allowed`);
}

function mentionsGhOrGit(tokens) {
  return tokens.some(({ text }) => {
    const name = basename(text);
    return name === 'gh' || name === 'git' || text.includes('gh ') || text.includes('git ');
  });
}

function checkSegment(segment) {
  const tokens = stripLeadingWords(segment);
  if (tokens.length === 0) {
    return allow();
  }
  const [commandWord, ...args] = tokens;
  if (isOpaqueCommandWord(commandWord)) {
    return deny(`deps:update-analyst is read-only: a command name built from expansions or globs cannot be checked. ${GH_SUMMARY}; ${GIT_SUMMARY}`);
  }
  const name = basename(commandWord.text);
  if (name === 'gh' || name === 'git') {
    if (args.some(startsWithExpansion)) {
      return deny(`deps:update-analyst is read-only: ${name} arguments that start with an expansion cannot be checked; write them out literally. ${name === 'gh' ? GH_SUMMARY : GIT_SUMMARY}`);
    }
    return name === 'gh' ? checkGh(args) : checkGit(args);
  }
  if (mentionsGhOrGit(tokens)) {
    return deny(`deps:update-analyst is read-only: gh and git must be invoked directly, not through another command. ${GH_SUMMARY}; ${GIT_SUMMARY}`);
  }
  return allow();
}

/**
 * Decides whether a PreToolUse hook call may run. Only the `deps:update-analyst` agent is
 * restricted, and only for Bash. Its `gh` and `git` use is limited to an allowlist of read
 * commands; anything not on the list is denied.
 *
 * @param {{ agent_type?: string, tool_name?: string, tool_input?: { command?: string } }} hookInput Parsed PreToolUse hook JSON.
 * @returns {{ decision: 'allow' } | { decision: 'deny', reason: string }}
 */
export function evaluateGuard(hookInput) {
  if (hookInput?.agent_type !== ANALYST_AGENT || hookInput.tool_name !== 'Bash') {
    return allow();
  }
  const command = hookInput.tool_input?.command;
  if (typeof command !== 'string') {
    return deny(`deps:update-analyst is read-only: the Bash command could not be read. ${GH_SUMMARY}; ${GIT_SUMMARY}`);
  }
  const segments = splitSegments(command);
  if (segments === null) {
    return deny(`deps:update-analyst is read-only: the command has an unterminated quote or substitution and cannot be checked. ${GH_SUMMARY}; ${GIT_SUMMARY}`);
  }
  for (const segment of segments) {
    const verdict = checkSegment(segment);
    if (verdict.decision === 'deny') {
      return verdict;
    }
  }
  return allow();
}
