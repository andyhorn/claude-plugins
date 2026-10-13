import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const ENTRIES_DIR = 'entries';
const ENVELOPE_KEYS = ['version', 'id', 'doc_id'];

async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toEntry(docId, parsed) {
  if (!isPlainObject(parsed)) {
    return null;
  }
  const version = Number.isInteger(parsed.version) ? parsed.version : null;
  if (isPlainObject(parsed.data)) {
    return { docId, version, data: parsed.data };
  }
  const data = Object.fromEntries(Object.entries(parsed).filter(([key]) => !ENVELOPE_KEYS.includes(key)));
  return { docId, version, data };
}

async function readEntry(directory, name) {
  try {
    const parsed = JSON.parse(await readFile(join(directory, name), 'utf8'));
    return toEntry(name.slice(0, -'.json'.length), parsed);
  } catch {
    return null;
  }
}

/**
 * Reads the documents that an `ArtifactData` query saved with `out_dir`. This is the one place that
 * knows the saved-file layout (`<out_dir>/entries/<doc_id>.json`).
 *
 * @param {string} dir Either the `out_dir` or its `entries` directory.
 * @returns {Promise<{ entries: { docId: string, version: number | null, data: object }[], unreadable: number }>}
 * @throws {Error} When the directory cannot be listed.
 */
export async function readSavedEntries(dir) {
  const nested = join(dir, ENTRIES_DIR);
  const directory = (await isDirectory(nested)) ? nested : dir;
  const names = (await readdir(directory)).filter((name) => name.endsWith('.json')).sort();
  const read = await Promise.all(names.map((name) => readEntry(directory, name)));
  const entries = read.filter((entry) => entry !== null);
  return { entries, unreadable: read.length - entries.length };
}
