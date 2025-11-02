import type { RepoData } from '../types';

export const repoData: RepoData = {
  c1: { pos: [0, 0, 0], parent: null, message: 'Initial commit', author: 'Alice Developer' },
  c2: { pos: [0, 2, 0], parent: 'c1', message: 'feat: Add user authentication', author: 'Alice Developer' },
  c3: { pos: [0, 4, 0], parent: 'c2', message: 'feat: Implement settings page', author: 'Bob Contributor' },
  // branch off c3
  b1_c1: { pos: [2, 5, 1], parent: 'c3', message: 'feat(API): Begin work on new endpoint', author: 'Charlie Maintainer' },
  b1_c2: { pos: [2, 7, 1], parent: 'b1_c1', message: 'fix(API): Correct data serialization', author: 'Charlie Maintainer' },
  // another branch off c3
  b2_c1: { pos: [-2, 5, -1], parent: 'c3', message: 'refactor: Improve database queries', author: 'Alice Developer' },
  b2_c2: { pos: [-2.5, 7, -1.5], parent: 'b2_c1', message: 'docs: Update README with new setup instructions', author: 'Bob Contributor' },
  b2_c3: { pos: [-2, 9, -1], parent: 'b2_c2', message: 'style: Format code with Prettier', author: 'Bob Contributor' },
   // merge b1 into main
  c4_merge: { pos: [0, 9, 0], parent: 'b1_c2', message: 'Merge branch \'feature/api-endpoint\'', author: 'Alice Developer' },
  c5: { pos: [0, 11, 0], parent: 'c4_merge', message: 'release: Version 1.0.0', author: 'Alice Developer' },
  // another branch off c2
  b3_c1: { pos: [3, 3, -2], parent: 'c2', message: 'fix: Handle edge case in login form', author: 'Charlie Maintainer' },
  b3_c2: { pos: [4, 4.5, -3], parent: 'b3_c1', message: 'test: Add unit tests for form validation', author: 'Charlie Maintainer' },
};