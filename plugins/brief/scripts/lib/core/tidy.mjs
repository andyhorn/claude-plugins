import { docIdFor, isoSeconds } from './keys.mjs';
import { pickPr } from './prs.mjs';

const BATCH_SIZE = 50;
const PRUNE_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

function compareText(a, b) {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
}

function instantOf(text) {
  if (typeof text !== 'string' || !ISO_INSTANT.test(text)) {
    return null;
  }
  const time = Date.parse(text);
  return Number.isNaN(time) ? null : time;
}

function isUsable(entry, repo, host) {
  const data = entry?.data;
  if (data === null || typeof data !== 'object') {
    return false;
  }
  const hasFields = typeof data.host === 'string' && typeof data.worktree === 'string' && typeof data.ts === 'string';
  return hasFields && data.repo === repo && data.host === host;
}

function isNewer(candidate, current) {
  const candidateTime = instantOf(candidate.data.ts) ?? Number.NEGATIVE_INFINITY;
  const currentTime = instantOf(current.data.ts) ?? Number.NEGATIVE_INFINITY;
  if (candidateTime !== currentTime) {
    return candidateTime > currentTime;
  }
  return candidate.docId > current.docId;
}

function latestOf(members) {
  return members.reduce((best, entry) => (isNewer(entry, best) ? entry : best));
}

function groupByWorktree(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const list = groups.get(entry.data.worktree) ?? [];
    list.push(entry);
    groups.set(entry.data.worktree, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => compareText(a, b))
    .map(([worktree, members]) => ({ worktree, members, latest: latestOf(members) }));
}

function chunk(items, size) {
  const batches = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

function mergedAfter(pr, ts) {
  if (!pr || pr.state !== 'MERGED' || typeof pr.mergedAt !== 'string') {
    return false;
  }
  const merged = instantOf(pr.mergedAt);
  const published = instantOf(ts);
  return merged !== null && published !== null && merged > published;
}

function archiveReason({ latest, livePaths, mainPath, prs, exists }) {
  const data = latest.data;
  if (data.status === 'archived' || data.worktree === mainPath) {
    return null;
  }
  if (!livePaths.has(data.worktree) && !exists(data.worktree)) {
    return { changed: 'Worktree removed.', pr: data.pr ?? null };
  }
  const pr = pickPr(prs, data.branch);
  if (mergedAfter(pr, data.ts)) {
    return { changed: `PR #${pr.number} merged.`, pr: pr.number };
  }
  return null;
}

function archiveWrite({ latest, reason, repo, now, docId }) {
  const data = latest.data;
  return {
    op: 'set',
    collection: 'entries',
    doc_id: docId,
    data: {
      v: 1,
      repo,
      repoName: data.repoName ?? null,
      host: data.host,
      worktree: data.worktree,
      branch: data.branch ?? null,
      head: data.head ?? null,
      ts: isoSeconds(now),
      status: 'archived',
      changed: reason.changed,
      decided: [],
      next: '',
      needs_you: null,
      pr: reason.pr,
    },
  };
}

function isPinnable(entry) {
  return Number.isSafeInteger(entry.version) && entry.version > 0;
}

function planPrune(group, cutoff) {
  const writes = [];
  let skipped = 0;
  const ordered = [...group.members].sort((a, b) => compareText(a.docId, b.docId));
  for (const entry of ordered) {
    if (entry === group.latest) {
      continue;
    }
    const time = instantOf(entry.data.ts);
    if (time === null) {
      skipped += 1;
    } else if (time < cutoff) {
      if (isPinnable(entry)) {
        writes.push({ op: 'delete', collection: 'entries', doc_id: entry.docId, if_version: entry.version });
      } else {
        skipped += 1;
      }
    }
  }
  return { writes, skipped };
}

/**
 * Plans the writes that archive finished worktrees and prune old entries. Only entries for this
 * repo and this host are considered.
 *
 * @param {object} input
 * @param {{ docId: string, version: number | null, data: object }[]} input.entries Saved entries.
 * @param {{ path: string, prunable: boolean, isMain: boolean }[]} input.worktrees
 * @param {{ number: number, state: string, mergedAt: string | null, headRefName: string }[]} input.prs
 * @param {string} input.repo Repo key.
 * @param {string} input.host
 * @param {Date} input.now
 * @param {() => string} input.newId Random doc id suffix.
 * @param {(path: string) => boolean} input.exists Whether a worktree path still exists on this host.
 * @returns {{ archive: object[][], prune: object[][], skipped: number }} Write batches of at most 50.
 */
export function planTidy({ entries, worktrees, prs, repo, host, now, newId, exists }) {
  const usable = entries.filter((entry) => isUsable(entry, repo, host));
  const groups = groupByWorktree(usable);
  const livePaths = new Set(worktrees.filter((row) => !row.prunable).map((row) => row.path));
  const mainPath = worktrees.find((row) => row.isMain)?.path ?? null;
  const cutoff = now.getTime() - PRUNE_AGE_MS;
  const archiveWrites = [];
  const pruneWrites = [];
  let skipped = 0;
  for (const group of groups) {
    const reason = archiveReason({ latest: group.latest, livePaths, mainPath, prs, exists });
    if (reason) {
      const docId = docIdFor(now, newId());
      archiveWrites.push(archiveWrite({ latest: group.latest, reason, repo, now, docId }));
    }
    const prune = planPrune(group, cutoff);
    pruneWrites.push(...prune.writes);
    skipped += prune.skipped;
  }
  return { archive: chunk(archiveWrites, BATCH_SIZE), prune: chunk(pruneWrites, BATCH_SIZE), skipped };
}
