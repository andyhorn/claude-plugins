/** Hidden marker that identifies comments written by this plugin. */
export const MARKER = '<!-- deps:triage -->';

/** Largest comment body this plugin writes; GitHub's own limit is 65536. */
export const MAX_COMMENT_LENGTH = 65000;

const TRUNCATION_NOTICE = '\n\n…(truncated)';
const ZERO_WIDTH_SPACE = '​';
// GitHub pings after any non-word character, so only a word character before the @ makes it an email address.
const MENTION = /(?<![A-Za-z0-9_])@(?=[A-Za-z0-9])/g;
const HTML_COMMENT_OPEN = /<!--/g;

function isHighSurrogate(code) {
  return code >= 0xd800 && code <= 0xdbff;
}

function truncate(text, limit) {
  if (text.length <= limit) {
    return text;
  }
  let end = limit - TRUNCATION_NOTICE.length;
  if (end > 0 && isHighSurrogate(text.charCodeAt(end - 1))) {
    end -= 1;
  }
  return text.slice(0, Math.max(end, 0)) + TRUNCATION_NOTICE;
}

/**
 * Makes untrusted text safe to post as a PR comment: neutralizes `@mentions` the way Dependabot
 * does, escapes HTML comment openers so the text cannot forge {@link MARKER}, and truncates so the
 * marker plus this text fit within {@link MAX_COMMENT_LENGTH}. Idempotent.
 *
 * @param {string} text
 * @returns {string}
 */
export function sanitizeComment(text) {
  const source = String(text ?? '');
  const withoutComments = source.replace(HTML_COMMENT_OPEN, '&lt;!--');
  const withoutMentions = withoutComments.replace(MENTION, `@${ZERO_WIDTH_SPACE}`);
  const budget = MAX_COMMENT_LENGTH - MARKER.length - 1;
  return truncate(withoutMentions, budget);
}

/**
 * Builds the full comment body: the marker line followed by the sanitized text.
 *
 * @param {string} text
 * @returns {string} At most {@link MAX_COMMENT_LENGTH} characters.
 */
export function buildCommentBody(text) {
  return `${MARKER}\n${sanitizeComment(text)}`;
}
