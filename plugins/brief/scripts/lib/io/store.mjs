import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ARTIFACT_URL } from '../core/keys.mjs';

const STATE_FILE = 'state.json';

/**
 * Reads the saved dashboard state.
 *
 * @param {string} dataDir
 * @returns {Promise<{ url: string, pageVersion: number } | null>} `null` when missing or invalid.
 */
export async function readState(dataDir) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(join(dataDir, STATE_FILE), 'utf8'));
  } catch {
    return null;
  }
  const valid = typeof parsed?.url === 'string' && ARTIFACT_URL.test(parsed.url) && Number.isSafeInteger(parsed.pageVersion) && parsed.pageVersion > 0;
  return valid ? { url: parsed.url, pageVersion: parsed.pageVersion } : null;
}

/**
 * Atomically writes the dashboard state, creating the data directory when needed.
 *
 * @param {string} dataDir
 * @param {{ url: string, pageVersion: number }} state
 * @returns {Promise<void>}
 */
export async function writeState(dataDir, state) {
  await mkdir(dataDir, { recursive: true });
  const temporary = join(dataDir, `${STATE_FILE}.${randomBytes(6).toString('hex')}.tmp`);
  await writeFile(temporary, `${JSON.stringify({ url: state.url, pageVersion: state.pageVersion })}\n`);
  await rename(temporary, join(dataDir, STATE_FILE));
}
