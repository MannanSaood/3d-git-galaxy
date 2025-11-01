export interface CommitNode {
  pos: [number, number, number];
  parent: string | null;
  message: string;
}

export interface RepoData {
  [commitHash: string]: CommitNode;
}

