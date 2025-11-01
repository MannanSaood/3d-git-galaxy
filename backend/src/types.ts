export interface CommitNode {
  pos: [number, number, number];
  parent: string | null;
  message: string;
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

