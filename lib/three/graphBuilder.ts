import * as THREE from 'three';
import type { RepoData } from '../../types';

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

  // Create Branches (Lines)
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