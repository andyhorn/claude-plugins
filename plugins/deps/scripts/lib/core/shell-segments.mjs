/**
 * @typedef {object} ShellToken
 * @property {string} text The word with quoting and escapes removed.
 * @property {boolean} dynamic Whether the word contains an expansion that cannot be resolved statically.
 * @property {number} redirectAt Index in `text` of the first unquoted `>`, or -1 when there is none.
 */

function newList(closer) {
  return { closer, tokens: [], text: '', dynamic: false, inToken: false, redirectAt: -1, afterOperator: false };
}

function endToken(list) {
  if (list.inToken) {
    list.tokens.push({ text: list.text, dynamic: list.dynamic, redirectAt: list.redirectAt });
  }
  list.text = '';
  list.dynamic = false;
  list.inToken = false;
  list.redirectAt = -1;
  list.afterOperator = false;
}

function endSegment(state, list) {
  endToken(list);
  if (list.tokens.length > 0) {
    state.segments.push(list.tokens);
  }
  list.tokens = [];
}

function append(list, char) {
  list.text += char;
  list.inToken = true;
  list.afterOperator = false;
}

function appendOperator(list, char) {
  if (char === '>' && list.redirectAt === -1) {
    list.redirectAt = list.text.length;
  }
  list.text += char;
  list.inToken = true;
  list.afterOperator = true;
}

function substitute(state, list, closer) {
  append(list, '$');
  list.dynamic = true;
  return parseList(state, closer);
}

function parseDoubleQuoted(state, list) {
  const { command } = state;
  list.inToken = true;
  while (state.pos < command.length) {
    const char = command[state.pos];
    const next = command[state.pos + 1];
    if (char === '"') {
      state.pos += 1;
      return true;
    }
    if (char === '\\' && next !== undefined && '"\\$`'.includes(next)) {
      append(list, next);
      state.pos += 2;
    } else if (char === '$' && next === '(') {
      state.pos += 2;
      if (!substitute(state, list, ')')) {
        return false;
      }
    } else if (char === '`') {
      state.pos += 1;
      if (!substitute(state, list, '`')) {
        return false;
      }
    } else {
      if (char === '$') {
        list.dynamic = true;
      }
      append(list, char);
      state.pos += 1;
    }
  }
  return false;
}

function parseSingleQuoted(state, list) {
  list.inToken = true;
  const end = state.command.indexOf("'", state.pos);
  if (end === -1) {
    return false;
  }
  list.text += state.command.slice(state.pos, end);
  list.afterOperator = false;
  state.pos = end + 1;
  return true;
}

function parseAmpersand(state, list, next) {
  if (list.afterOperator || next === '>') {
    append(list, '&');
  } else {
    endSegment(state, list);
  }
  state.pos += 1;
}

function parseBackslash(state, list, next) {
  if (next === '\n') {
    state.pos += 2;
  } else if (next === undefined) {
    state.pos += 1;
  } else {
    append(list, next);
    state.pos += 2;
  }
}

function parseListChar(state, list, char, next) {
  if (char === ' ' || char === '\t' || char === '\r') {
    endToken(list);
    state.pos += 1;
  } else if (char === '\n' || char === ';' || char === '|' || char === ')') {
    endSegment(state, list);
    state.pos += 1;
  } else if (char === '&') {
    parseAmpersand(state, list, next);
  } else if (char === '(') {
    endSegment(state, list);
    state.pos += 1;
    return parseList(state, ')');
  } else if (char === '$' && next === '(') {
    state.pos += 2;
    return substitute(state, list, ')');
  } else if (char === '`') {
    state.pos += 1;
    return substitute(state, list, '`');
  } else if (char === '"') {
    state.pos += 1;
    return parseDoubleQuoted(state, list);
  } else if (char === "'") {
    state.pos += 1;
    return parseSingleQuoted(state, list);
  } else if (char === '\\') {
    parseBackslash(state, list, next);
  } else if (char === '<' || char === '>') {
    appendOperator(list, char);
    state.pos += 1;
  } else {
    if (char === '$') {
      list.dynamic = true;
    }
    append(list, char);
    state.pos += 1;
  }
  return true;
}

function parseList(state, closer) {
  const { command } = state;
  const list = newList(closer);
  while (state.pos < command.length) {
    const char = command[state.pos];
    if (char === closer) {
      state.pos += 1;
      endSegment(state, list);
      return true;
    }
    if (!parseListChar(state, list, char, command[state.pos + 1])) {
      return false;
    }
  }
  endSegment(state, list);
  return closer === null;
}

/**
 * Splits a shell command into simple-command segments of tokens. Command substitutions become
 * their own segments, including those inside double quotes. Returns null when a quote or
 * substitution is left open, because such a command cannot be analyzed.
 *
 * @param {string} command
 * @returns {ShellToken[][] | null}
 */
export function splitSegments(command) {
  const state = { command, pos: 0, segments: [] };
  return parseList(state, null) ? state.segments : null;
}
