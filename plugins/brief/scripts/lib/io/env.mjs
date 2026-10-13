import { createHash, randomBytes } from 'node:crypto';
import { hostname } from 'node:os';

const ID_LENGTH = 6;

function randomBase36(length) {
  const bytes = randomBytes(length);
  return Array.from(bytes, (byte) => (byte % 36).toString(36)).join('');
}

/**
 * Creates the environment dependencies that the pure core receives by injection.
 *
 * @returns {{ now: () => Date, newId: () => string, hostname: () => string, sha1: (text: string) => string }}
 */
export function createEnv() {
  return {
    now: () => new Date(),
    newId: () => randomBase36(ID_LENGTH),
    hostname: () => hostname(),
    sha1: (text) => createHash('sha1').update(text).digest('hex'),
  };
}
