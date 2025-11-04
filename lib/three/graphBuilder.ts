import * as THREE from 'three';
import type { RepoData, PullRequest, Settings } from '../../types';

// Theme color palettes
const themePalettes: Record<string, THREE.Color[]> = {
  cyberpunk: [
    new THREE.Color(0xff00ff), // Magenta
    new THREE.Color(0x00ffff), // Cyan
    new THREE.Color(0xffff00), // Yellow
    new THREE.Color(0xff0080), // Hot Pink
    new THREE.Color(0x00ff80), // Bright Green
  ],
  forest: [
    new THREE.Color(0x228b22), // Forest Green
    new THREE.Color(0x90ee90), // Light Green
    new THREE.Color(0x3cb371), // Medium Sea Green
    new THREE.Color(0x556b2f), // Dark Olive Green
    new THREE.Color(0x6b8e23), // Olive Drab
  ],
  solarized: [
    new THREE.Color(0x268bd2), // Blue
    new THREE.Color(0x2aa198), // Cyan
    new THREE.Color(0x859900), // Green
    new THREE.Color(0xb58900), // Yellow
    new THREE.Color(0xcb4b16), // Orange
  ],
};

export const buildGraph = (scene: THREE.Scene, repoData: RepoData, settings: Settings) => {
  console.log('[buildGraph] Starting graph build with', Object.keys(repoData).length, 'commits');
  
  const commitPositions: number[] = [];
  const commitObjects = new THREE.Group();
  const branchObjects = new THREE.Group();
  
  const commitHashes = Object.keys(repoData);
  
  if (commitHashes.length === 0) {
    console.error('[buildGraph] No commits found in repoData!');
    return { commitObjects, branchObjects, commitHashes: [] };
  }

  // Create Commits (Stars)
  for (const hash of commitHashes) {
    const commit = repoData[hash];
    if (!commit || !commit.pos || !Array.isArray(commit.pos) || commit.pos.length !== 3) {
      console.warn('[buildGraph] Invalid commit data for hash:', hash, commit);
      continue;
    }
    commitPositions.push(...commit.pos);
  }
  
  if (commitPositions.length === 0) {
    console.error('[buildGraph] No valid commit positions found!');
    return { commitObjects, branchObjects, commitHashes: [] };
  }
  
  console.log('[buildGraph] Created', commitPositions.length / 3, 'commit positions');
  
  const pointsGeometry = new THREE.BufferGeometry();
  pointsGeometry.setAttribute('position', new THREE.Float32BufferAttribute(commitPositions, 3));
  
  const pointsMaterial = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.25,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
    depthWrite: false,
    vertexColors: true, // Enable vertex colors
  });
  
  // Set initial color for all vertices
  const colors = new Float32Array(commitPositions.length);
  for (let i = 0; i < colors.length; i += 3) {
      colors[i] = 1.0;
      colors[i+1] = 1.0;
      colors[i+2] = 1.0;
  }
  pointsGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const stars = new THREE.Points(pointsGeometry, pointsMaterial);
  commitObjects.add(stars);

  // Create Branches (Lines) - Use theme-based colors
  const palette = themePalettes[settings.theme] || themePalettes.cyberpunk;
  let branchIndex = 0;
  
  for (const hash of commitHashes) {
    const commit = repoData[hash];
    if (commit.parent && repoData[commit.parent]) {
      const parentCommit = repoData[commit.parent];
      const startVec = new THREE.Vector3(...parentCommit.pos);
      const endVec = new THREE.Vector3(...commit.pos);

      const curve = new THREE.LineCurve3(startVec, endVec);
      const tubeGeometry = new THREE.TubeGeometry(curve, 20, 0.02, 8, false);
      
      // Select color from theme palette based on branch index
      const branchColor = palette[branchIndex % palette.length].clone();
      const tubeMaterial = new THREE.MeshBasicMaterial({
        color: branchColor,
      });

      const tube = new THREE.Mesh(tubeGeometry, tubeMaterial);
      branchObjects.add(tube);
      branchIndex++;
    }
  }

  scene.add(commitObjects);
  scene.add(branchObjects);

  return { stars };
};

// Phase 7: Build Pull Request visualizations
export const buildPullRequests = (
  scene: THREE.Scene,
  prData: PullRequest[],
  repoData: RepoData
) => {
  const prGroup = new THREE.Group();
  const animatedMaterials: THREE.MeshBasicMaterial[] = [];
  
  prData.forEach((pr) => {
    const headCommit = repoData[pr.headSha];
    const baseCommit = repoData[pr.baseSha];
    
    if (!headCommit || !baseCommit) {
      return; // Skip if commits not found
    }
    
    const headPos = new THREE.Vector3(...headCommit.pos);
    const basePos = new THREE.Vector3(...baseCommit.pos);
    
    const curve = new THREE.LineCurve3(basePos, headPos);
    const tubeGeometry = new THREE.TubeGeometry(curve, 20, 0.03, 8, false);
    
    // Color based on PR state
    let color: THREE.Color;
    if (pr.state === 'merged') {
      color = new THREE.Color(0x00ff00); // Green for merged
    } else if (pr.state === 'open') {
      color = new THREE.Color(0x00ffff); // Cyan for open (will pulse)
    } else {
      color = new THREE.Color(0xff0000); // Red for closed
    }
    
    const material = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.7
    });
    
    const tube = new THREE.Mesh(tubeGeometry, material);
    
    // Track animated materials (animation will be handled in main render loop)
    if (pr.state === 'open') {
      animatedMaterials.push(material);
    }
    
    prGroup.add(tube);
    
    // Add comment/review indicator sprite at midpoint
    const midpoint = new THREE.Vector3().addVectors(basePos, headPos).multiplyScalar(0.5);
    const spriteMaterial = new THREE.SpriteMaterial({
      color: color,
      transparent: true,
      opacity: 0.8
    });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.position.copy(midpoint);
    sprite.scale.set(0.1, 0.1, 1);
    prGroup.add(sprite);
  });
  
  scene.add(prGroup);
  return { prGroup, animatedMaterials };
};