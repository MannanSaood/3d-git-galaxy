import * as THREE from 'three';
import type { RepoData, PullRequest } from '../../types';

export const buildGraph = (scene: THREE.Scene, repoData: RepoData) => {
  const commitPositions: number[] = [];
  const commitObjects = new THREE.Group();
  const branchObjects = new THREE.Group();
  
  const commitHashes = Object.keys(repoData);

  // Create Commits (Stars)
  for (const hash of commitHashes) {
    const commit = repoData[hash];
    commitPositions.push(...commit.pos);
  }
  
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

  // Create Branches (Lines) - Reverted to original implementation to prevent artifacts
  for (const hash of commitHashes) {
    const commit = repoData[hash];
    if (commit.parent && repoData[commit.parent]) {
      const parentCommit = repoData[commit.parent];
      const startVec = new THREE.Vector3(...parentCommit.pos);
      const endVec = new THREE.Vector3(...commit.pos);

      const curve = new THREE.LineCurve3(startVec, endVec);
      const tubeGeometry = new THREE.TubeGeometry(curve, 20, 0.02, 8, false);
      
      const branchColor = new THREE.Color(0xffffff).setHSL(Math.random(), 0.7, 0.6);
      const tubeMaterial = new THREE.MeshBasicMaterial({
        color: branchColor,
      });

      const tube = new THREE.Mesh(tubeGeometry, tubeMaterial);
      branchObjects.add(tube);
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
    
    // Add pulsing animation for open PRs
    if (pr.state === 'open') {
      const animate = () => {
        const time = Date.now() * 0.001;
        material.opacity = 0.5 + Math.sin(time * 2) * 0.3;
        requestAnimationFrame(animate);
      };
      animate();
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
  return { prGroup };
};