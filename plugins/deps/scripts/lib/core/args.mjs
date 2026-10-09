/** The `parseArgs` configuration for the triage CLI. */
export const PARSE_OPTIONS = Object.freeze({
  options: {
    pr: { type: 'string' },
    'body-file': { type: 'string' },
  },
  allowPositionals: true,
  strict: true,
});

const COMMANDS = ['collect', 'comment'];
const POSITIVE_INTEGER = /^[1-9]\d*$/;
const MAX_PR_NUMBER = 2147483647;

function parsePrNumber(text) {
  if (typeof text !== 'string' || !POSITIVE_INTEGER.test(text)) {
    return null;
  }
  const number = Number(text);
  return Number.isSafeInteger(number) && number <= MAX_PR_NUMBER ? number : null;
}

function validateCollect(values, extra) {
  if (values.pr !== undefined || values['body-file'] !== undefined) {
    return { ok: false, error: 'collect takes an optional PR number, not --pr or --body-file' };
  }
  if (extra.length > 1) {
    return { ok: false, error: 'collect takes at most one PR number' };
  }
  if (extra.length === 0) {
    return { ok: true, command: 'collect', pr: null };
  }
  const pr = parsePrNumber(extra[0]);
  if (pr === null) {
    return { ok: false, error: `PR number must be a positive integer, got: ${extra[0]}` };
  }
  return { ok: true, command: 'collect', pr };
}

function validateComment(values, extra) {
  if (extra.length > 0) {
    return { ok: false, error: 'comment takes no positional arguments; use --pr and --body-file' };
  }
  const pr = parsePrNumber(values.pr);
  if (pr === null) {
    return { ok: false, error: 'comment requires --pr <positive integer>' };
  }
  const bodyFile = values['body-file'];
  if (typeof bodyFile !== 'string' || bodyFile === '') {
    return { ok: false, error: 'comment requires --body-file <path>' };
  }
  return { ok: true, command: 'comment', pr, bodyFile };
}

/**
 * Validates the output of `parseArgs` called with {@link PARSE_OPTIONS}.
 *
 * @param {{ values: Record<string, string | undefined>, positionals: string[] }} parsed
 * @returns {{ ok: true, command: 'collect', pr: number | null } | { ok: true, command: 'comment', pr: number, bodyFile: string } | { ok: false, error: string }}
 */
export function validateArgs({ values, positionals }) {
  const [command, ...extra] = positionals;
  if (command === 'collect') {
    return validateCollect(values, extra);
  }
  if (command === 'comment') {
    return validateComment(values, extra);
  }
  const shown = command === undefined ? 'missing command' : `unknown command: ${command}`;
  return { ok: false, error: `${shown}; expected one of: ${COMMANDS.join(', ')}` };
}
