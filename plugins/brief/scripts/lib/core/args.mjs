import { ARTIFACT_URL } from './keys.mjs';

/** The `parseArgs` configuration for the brief CLI. */
export const PARSE_OPTIONS = Object.freeze({
  options: {
    data: { type: 'string' },
    'set-url': { type: 'string' },
    'page-version': { type: 'string' },
    cwd: { type: 'string' },
    pr: { type: 'boolean' },
    entries: { type: 'string' },
  },
  allowPositionals: true,
  strict: true,
});

const COMMANDS = ['state', 'context', 'worktrees', 'tidy'];
const ALLOWED_OPTIONS = Object.freeze({
  state: ['data', 'set-url', 'page-version'],
  context: ['data', 'cwd'],
  worktrees: ['data', 'pr'],
  tidy: ['data', 'entries'],
});
const POSITIVE_INTEGER = /^[1-9]\d*$/;
const ABSOLUTE = /^\//;

function foreignOption(command, values) {
  const allowed = ALLOWED_OPTIONS[command];
  return Object.keys(values).find((name) => values[name] !== undefined && !allowed.includes(name));
}

function absolutePath(value, flag) {
  if (typeof value !== 'string' || !ABSOLUTE.test(value)) {
    return `${flag} must be an absolute path, got: ${value}`;
  }
  return null;
}

function validateState(values, data) {
  const url = values['set-url'];
  const pageVersion = values['page-version'];
  if (url === undefined && pageVersion === undefined) {
    return { ok: true, command: 'state', data, set: null };
  }
  if (url === undefined || pageVersion === undefined) {
    return { ok: false, error: 'state needs --set-url and --page-version together' };
  }
  if (!ARTIFACT_URL.test(url)) {
    return { ok: false, error: `--set-url must be a claude.ai artifact URL, got: ${url}` };
  }
  if (!POSITIVE_INTEGER.test(pageVersion) || !Number.isSafeInteger(Number(pageVersion))) {
    return { ok: false, error: `--page-version must be a positive integer, got: ${pageVersion}` };
  }
  return { ok: true, command: 'state', data, set: { url, pageVersion: Number(pageVersion) } };
}

function validateContext(values, data) {
  const cwd = values.cwd;
  if (cwd === undefined) {
    return { ok: true, command: 'context', data, cwd: null };
  }
  const problem = absolutePath(cwd, '--cwd');
  return problem ? { ok: false, error: problem } : { ok: true, command: 'context', data, cwd };
}

function validateTidy(values, data) {
  const entries = values.entries;
  if (entries === undefined) {
    return { ok: false, error: 'tidy requires --entries <dir>' };
  }
  const problem = absolutePath(entries, '--entries');
  return problem ? { ok: false, error: problem } : { ok: true, command: 'tidy', data, entries };
}

/**
 * Validates the output of `parseArgs` called with {@link PARSE_OPTIONS}.
 *
 * @param {{ values: Record<string, string | boolean | undefined>, positionals: string[] }} parsed
 * @returns {{ ok: true, command: 'state', data: string, set: { url: string, pageVersion: number } | null }
 *   | { ok: true, command: 'context', data: string, cwd: string | null }
 *   | { ok: true, command: 'worktrees', data: string, pr: boolean }
 *   | { ok: true, command: 'tidy', data: string, entries: string }
 *   | { ok: false, error: string }}
 */
export function validateArgs({ values, positionals }) {
  const [command, ...extra] = positionals;
  if (!COMMANDS.includes(command)) {
    const shown = command === undefined ? 'missing command' : `unknown command: ${command}`;
    return { ok: false, error: `${shown}; expected one of: ${COMMANDS.join(', ')}` };
  }
  if (extra.length > 0) {
    return { ok: false, error: `${command} takes no extra arguments, got: ${extra.join(' ')}` };
  }
  const foreign = foreignOption(command, values);
  if (foreign !== undefined) {
    return { ok: false, error: `--${foreign} does not apply to ${command}` };
  }
  const data = values.data;
  if (data === undefined) {
    return { ok: false, error: `${command} requires --data <dir>` };
  }
  const dataProblem = absolutePath(data, '--data');
  if (dataProblem) {
    return { ok: false, error: dataProblem };
  }
  if (command === 'state') {
    return validateState(values, data);
  }
  if (command === 'context') {
    return validateContext(values, data);
  }
  if (command === 'tidy') {
    return validateTidy(values, data);
  }
  return { ok: true, command: 'worktrees', data, pr: values.pr === true };
}
