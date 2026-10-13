/**
 * The pinned GraphQL query that produced the raw fixtures under test/deps/fixtures/raw.
 * Variables: `owner` (String!), `name` (String!), `number` (Int!).
 * `contexts` selects `pageInfo` so a truncated check list can be detected.
 * The response `data` object is the input to {@link toSnapshot}.
 */
export const SNAPSHOT_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  viewer { login }
  repository(owner: $owner, name: $name) {
    nameWithOwner
    isArchived
    viewerPermission
    defaultBranchRef { name }
    pullRequest(number: $number) {
      number title body url isDraft isCrossRepository state
      author { __typename login }
      baseRefName headRefName headRefOid
      mergeable mergeStateStatus
      labels(first: 50) { nodes { name } }
      commits(last: 100) {
        totalCount
        nodes { commit {
          oid messageHeadline message
          author { name email user { login } }
          committer { name email user { login } }
          signature { isValid state wasSignedByGitHub signer { login } }
        } }
      }
      headCommit: commits(last: 1) { nodes { commit { oid
        statusCheckRollup { state contexts(first: 100) {
          totalCount
          pageInfo { hasNextPage endCursor }
          nodes {
            __typename
            ... on CheckRun { name status conclusion }
            ... on StatusContext { context state }
          }
        } }
      } } }
    }
  }
}
`;

/**
 * The query that fetches the next page of head-commit check contexts.
 * Variables: `owner` (String!), `name` (String!), `number` (Int!), `cursor` (String!).
 */
export const CONTEXTS_PAGE_QUERY = `query($owner: String!, $name: String!, $number: Int!, $cursor: String!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      headCommit: commits(last: 1) { nodes { commit {
        statusCheckRollup { contexts(first: 100, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            __typename
            ... on CheckRun { name status conclusion }
            ... on StatusContext { context state }
          }
        } }
      } } }
    }
  }
}
`;

/**
 * @typedef {object} SnapshotRepo
 * @property {string} nameWithOwner
 * @property {string | null} defaultBranch
 * @property {boolean} isArchived
 * @property {string} viewerPermission
 */

/**
 * @typedef {object} SnapshotAuthor
 * @property {string | null} type GraphQL `__typename` of the PR author, such as `Bot`.
 * @property {string | null} login
 */

/**
 * @typedef {object} SnapshotPr
 * @property {number} number
 * @property {string} title
 * @property {string} url
 * @property {string} body
 * @property {string} state
 * @property {boolean} isDraft
 * @property {boolean} isCrossRepository
 * @property {SnapshotAuthor} author
 * @property {string} baseRefName
 * @property {string} headRefName
 * @property {string} headRefOid
 * @property {string} mergeable
 * @property {string} mergeStateStatus
 * @property {string[]} labels
 */

/**
 * @typedef {object} SnapshotCommit
 * @property {string} oid
 * @property {string} message
 * @property {{ name: string | null, email: string | null, login: string | null }} author
 * @property {{ valid: boolean, signedByGitHub: boolean, signer: string | null }} signature
 */

/**
 * @typedef {object} SnapshotCheck
 * @property {'CheckRun' | 'StatusContext'} kind
 * @property {string} name
 * @property {string | null} status Always null for a StatusContext.
 * @property {string | null} conclusion The check conclusion, or the state of a StatusContext.
 */

/**
 * @typedef {object} Snapshot
 * @property {string | null} viewer
 * @property {SnapshotRepo} repo
 * @property {SnapshotPr} pr
 * @property {{ totalCount: number, items: SnapshotCommit[] }} commits
 * @property {{ oid: string | null, rollupState: string | null, totalCount: number, items: SnapshotCheck[] }} checks
 */

function toCommit(node) {
  const { commit } = node;
  const signature = commit.signature;
  return {
    oid: commit.oid,
    message: commit.message ?? '',
    author: {
      name: commit.author?.name ?? null,
      email: commit.author?.email ?? null,
      login: commit.author?.user?.login ?? null,
    },
    signature: {
      valid: signature?.isValid === true,
      signedByGitHub: signature?.wasSignedByGitHub === true,
      signer: signature?.signer?.login ?? null,
    },
  };
}

function toCheck(node) {
  if (node.__typename === 'StatusContext') {
    return {
      kind: 'StatusContext',
      name: node.context,
      status: null,
      conclusion: node.state ?? null,
    };
  }
  return {
    kind: 'CheckRun',
    name: node.name,
    status: node.status ?? null,
    conclusion: node.conclusion ?? null,
  };
}

function toChecks(headCommit) {
  const oid = headCommit?.oid ?? null;
  const rollup = headCommit?.statusCheckRollup;
  if (!rollup) {
    return { oid, rollupState: null, totalCount: 0, items: [] };
  }
  const nodes = (rollup.contexts?.nodes ?? []).filter(Boolean);
  return {
    oid,
    rollupState: rollup.state ?? null,
    totalCount: rollup.contexts?.totalCount ?? nodes.length,
    items: nodes.map(toCheck),
  };
}

/**
 * Converts the `data` object of a {@link SNAPSHOT_QUERY} response into a Snapshot.
 *
 * @param {object} data The GraphQL `data` object.
 * @returns {Snapshot}
 * @throws {Error} When the repository or the pull request is missing from the response.
 */
export function toSnapshot(data) {
  const repository = data?.repository;
  if (!repository) {
    throw new Error('Snapshot data has no repository; it may not exist or may not be visible to this account');
  }
  const pr = repository.pullRequest;
  if (!pr) {
    throw new Error(`Snapshot data has no pull request in ${repository.nameWithOwner}`);
  }
  const commitNodes = (pr.commits?.nodes ?? []).filter(Boolean);
  const headCommit = pr.headCommit?.nodes?.[0]?.commit;
  return {
    viewer: data.viewer?.login ?? null,
    repo: {
      nameWithOwner: repository.nameWithOwner,
      defaultBranch: repository.defaultBranchRef?.name ?? null,
      isArchived: repository.isArchived === true,
      viewerPermission: repository.viewerPermission,
    },
    pr: {
      number: pr.number,
      title: pr.title,
      url: pr.url,
      body: pr.body ?? '',
      state: pr.state,
      isDraft: pr.isDraft === true,
      isCrossRepository: pr.isCrossRepository === true,
      author: {
        type: pr.author?.__typename ?? null,
        login: pr.author?.login ?? null,
      },
      baseRefName: pr.baseRefName,
      headRefName: pr.headRefName,
      headRefOid: pr.headRefOid,
      mergeable: pr.mergeable,
      mergeStateStatus: pr.mergeStateStatus,
      labels: (pr.labels?.nodes ?? []).filter(Boolean).map((label) => label.name),
    },
    commits: {
      totalCount: pr.commits?.totalCount ?? commitNodes.length,
      items: commitNodes.map(toCommit),
    },
    checks: toChecks(headCommit),
  };
}
