export interface CommitNode {
  pos: [number, number, number];
  parent: string | null;
  message: string;
  author: string;
  branchColor?: string;
}

export interface RepoData {
  [commitHash: string]: CommitNode;
}

export interface ConstellationRepo {
  id: number;
  name: string;
  full_name: string;
  clone_url: string;
  pos: [number, number, number];
}

export interface User {
  login: string;
  avatar_url: string;
}

export interface DiffStat {
  filesChanged: number;
  insertions: number;
  deletions: number;
}

export interface Author {
  name: string;
  commitCount: number;
}

export interface PullRequest {
  id: number;
  title: string;
  state: 'open' | 'merged' | 'closed';
  headSha: string;
  baseSha: string;
}

