import { readFileSync } from 'node:fs';

export function loadRaw(name) {
  const url = new URL(`./fixtures/raw/${name}`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')).data;
}

export function loadFixture(name) {
  const url = new URL(`./fixtures/${name}`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8'));
}

/**
 * Applies dot-path assignments to a deep copy of the snapshot. Numeric segments index arrays,
 * and missing intermediate containers are created.
 */
export function applySet(snapshot, set) {
  const copy = structuredClone(snapshot);
  for (const [path, value] of Object.entries(set ?? {})) {
    const segments = path.split('.');
    const last = segments.pop();
    let target = copy;
    for (const [index, segment] of segments.entries()) {
      if (target[segment] === undefined) {
        target[segment] = /^\d+$/.test(segments[index + 1] ?? last) ? [] : {};
      }
      target = target[segment];
    }
    target[last] = structuredClone(value);
  }
  return copy;
}
