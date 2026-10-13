const BLOCK_START = /^updated-dependencies:\s*$/;
const BLOCK_END = /^\.\.\.\s*$/;
const ENTRY_START = /^-\s+([A-Za-z0-9_-]+):\s*(.*)$/;
const ENTRY_FIELD = /^\s+([A-Za-z0-9_-]+):\s*(.*)$/;
const UPDATE_TYPES = {
  'version-update:semver-major': 'major',
  'version-update:semver-minor': 'minor',
  'version-update:semver-patch': 'patch',
};
const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/;
const BUMP_LINE = /^Bumps (.+?) from (\S+) to (\S+)$/;
const LINKED_NAME = /\[([^\]]+)\]\(/g;
const TABLE_ROW = /^\|\s*\[([^\]]+)\]\([^)]*\)\s*\|\s*`?([^`|\s]+)`?\s*\|\s*`?([^`|\s]+)`?\s*\|\s*$/;
const UPDATES_LINE = /^Updates `([^`]+)` from (\S+) to (\S+)$/;

function unquote(value) {
  const trimmed = value.trim();
  const quoted = /^(['"])(.*)\1$/.exec(trimmed);
  return quoted ? quoted[2] : trimmed;
}

function splitLines(text) {
  return String(text ?? '').split(/\r\n|\r|\n/);
}

function findBlock(lines) {
  const startIndex = lines.findLastIndex((line) => BLOCK_START.test(line));
  if (startIndex === -1) {
    return { reason: 'no updated-dependencies block' };
  }
  const rest = lines.slice(startIndex + 1);
  const endOffset = rest.findIndex((line) => BLOCK_END.test(line));
  if (endOffset === -1) {
    return { reason: 'updated-dependencies block is not terminated' };
  }
  return { body: rest.slice(0, endOffset) };
}

function groupEntries(blockLines) {
  const entries = [];
  for (const line of blockLines) {
    if (line.trim() === '') {
      continue;
    }
    const start = ENTRY_START.exec(line);
    if (start) {
      entries.push({ [start[1]]: unquote(start[2]) });
      continue;
    }
    const field = ENTRY_FIELD.exec(line);
    if (field && entries.length > 0) {
      entries[entries.length - 1][field[1]] = unquote(field[2]);
      continue;
    }
    return { reason: `unrecognized line in updated-dependencies block: ${line.trim().slice(0, 60)}` };
  }
  return { entries };
}

function toUpdate(entry) {
  return {
    name: entry['dependency-name'],
    version: entry['dependency-version'],
    dependencyType: entry['dependency-type'] ?? null,
    updateType: UPDATE_TYPES[entry['update-type']] ?? null,
    group: entry['dependency-group'] ?? null,
  };
}

function missingRequiredField(entries) {
  const index = entries.findIndex((entry) => !entry['dependency-name'] || !entry['dependency-version']);
  return index === -1 ? null : `entry ${index + 1} lacks dependency-name or dependency-version`;
}

/**
 * Parses the `updated-dependencies:` block that Dependabot writes into its commit messages.
 * The last block in the message is used, because Dependabot appends it after any other text.
 * Never throws.
 *
 * @param {string} message A commit message.
 * @returns {{ ok: true, updates: Array<{ name: string, version: string, dependencyType: string | null, updateType: 'major' | 'minor' | 'patch' | null, group: string | null }> } | { ok: false, reason: string }}
 */
export function parseUpdatedDependencies(message) {
  try {
    const block = findBlock(splitLines(message));
    if (!block.body) {
      return { ok: false, reason: block.reason };
    }
    const grouped = groupEntries(block.body);
    if (!grouped.entries) {
      return { ok: false, reason: grouped.reason };
    }
    if (grouped.entries.length === 0) {
      return { ok: false, reason: 'updated-dependencies block has no entries' };
    }
    const missing = missingRequiredField(grouped.entries);
    if (missing) {
      return { ok: false, reason: missing };
    }
    return { ok: true, updates: grouped.entries.map(toUpdate) };
  } catch {
    return { ok: false, reason: 'could not parse updated-dependencies block' };
  }
}

function trimTrailingPeriod(version) {
  return version.replace(/\.$/, '');
}

function fromVersionsInLine(line) {
  const trimmed = line.trim();
  const bump = BUMP_LINE.exec(trimmed);
  if (bump) {
    const from = trimTrailingPeriod(bump[2]);
    return [...bump[1].matchAll(LINKED_NAME)].map((match) => [match[1], from]);
  }
  const row = TABLE_ROW.exec(trimmed);
  if (row) {
    return [[row[1], row[2]]];
  }
  const updates = UPDATES_LINE.exec(trimmed);
  if (updates) {
    return [[updates[1], updates[2]]];
  }
  return [];
}

/**
 * Extracts from-versions from a PR body or commit message. Understands
 * `Bumps [name](url) from A to B.`, grouped table rows, and ``Updates `name` from A to B`` lines.
 * The first occurrence of a name wins. Never throws.
 *
 * @param {string} text A PR body or commit message.
 * @returns {Record<string, string>} Map of dependency name to from-version; unknown names are absent.
 */
export function parseFromVersions(text) {
  try {
    const found = new Map();
    for (const line of splitLines(text)) {
      for (const [name, from] of fromVersionsInLine(line)) {
        if (!found.has(name)) {
          found.set(name, from);
        }
      }
    }
    return Object.fromEntries(found);
  } catch {
    return {};
  }
}

function adjustsToMajor(updateType, version) {
  const match = SEMVER.exec(String(version ?? ''));
  if (!match) {
    return false;
  }
  const [, major, minor] = match;
  if (major !== '0') {
    return false;
  }
  if (updateType === 'minor') {
    return true;
  }
  return updateType === 'patch' && minor === '0';
}

/**
 * Computes the review-relevant semver level of an update. A minor bump to `0.y.z` and a patch
 * bump to `0.0.z` are breaking by semver convention, so they count as major.
 *
 * @param {'major' | 'minor' | 'patch' | null | undefined} updateType Dependabot's declared level.
 * @param {string} version The new version.
 * @returns {'major' | 'minor' | 'patch' | 'unknown'}
 */
export function effectiveLevel(updateType, version) {
  if (updateType !== 'major' && updateType !== 'minor' && updateType !== 'patch') {
    return 'unknown';
  }
  return adjustsToMajor(updateType, version) ? 'major' : updateType;
}

const VERSION = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([^+]+))?(?:\+.*)?$/;

function parseVersion(value) {
  const match = VERSION.exec(String(value ?? '').trim());
  if (!match) {
    return null;
  }
  const numbers = [match[1], match[2] ?? '0', match[3] ?? '0'].map(Number);
  return { numbers, prerelease: match[4] ?? null };
}

function sign(difference) {
  if (difference === 0) {
    return 0;
  }
  return difference < 0 ? -1 : 1;
}

function comparePrerelease(a, b) {
  if (a === b) {
    return 0;
  }
  if (a === null) {
    return 1;
  }
  if (b === null) {
    return -1;
  }
  return a < b ? -1 : 1;
}

/**
 * Compares two versions of the form `[v]MAJOR[.MINOR[.PATCH]][-prerelease][+build]`, zero-filling
 * missing parts and ignoring build metadata. A prerelease sorts below its release, and prerelease
 * strings compare lexically.
 *
 * @param {string} a
 * @param {string} b
 * @returns {-1 | 0 | 1 | null} `null` when either version is not in that form.
 */
export function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) {
    return null;
  }
  for (let index = 0; index < 3; index += 1) {
    const difference = left.numbers[index] - right.numbers[index];
    if (difference !== 0) {
      return sign(difference);
    }
  }
  return comparePrerelease(left.prerelease, right.prerelease);
}
